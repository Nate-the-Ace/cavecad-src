/**
 * RibbonCommands -- the ribbon's everyday tabs, laid out the AutoCAD way.
 *
 * Home, Insert, Annotate, View, Manage and Output hold the app's commands in
 * panels. A command is named by its script file ("Modify/Trim/Trim.js"); one that
 * has variants is a SPLIT button: the button runs the main command and its arrow
 * lists the variants, taken from one of the app's own menus ("DrawLineMenu") or from
 * a list. Commands the build does not have are hidden, and so is a panel left empty.
 *
 *     RibbonCommands.register();
 *
 * Contextual tabs (Layout, Viewport, Editing, and a command's options) are
 * registered elsewhere and come after these.
 */

function RibbonCommands() {
}

RibbonCommands.registered = false;

/** True for a menu name ("DrawLineMenu") or a list of them; a list of script files is the other kind. */
RibbonCommands.isMenuName = function(from) {
    if (typeof from === "string") { return true; }
    return from instanceof Array && from.length > 0 && /Menu$/.test(String(from[0]));
};

/** A button for the command in `file`; `o` adds size, text, icon ... */
RibbonCommands.cmd = function(file, o) {
    var item = { type: "button", action: file, size: "large" };
    for (var k in o) { if (o.hasOwnProperty(k)) { item[k] = o[k]; } }
    return item;
};

/** A split button: `file` runs, the arrow lists `menuFrom` (a menu name) or `dropdown` (script files). */
RibbonCommands.split = function(file, from, o) {
    var item = { type: "button", action: file, size: "large" };
    if (RibbonCommands.isMenuName(from)) { item.menuFrom = from; } else { item.dropdown = from; }
    for (var k in o) { if (o.hasOwnProperty(k)) { item[k] = o[k]; } }
    return item;
};

/** A dropdown with no main command of its own. */
RibbonCommands.menu = function(from, o) {
    var item = { type: "button", size: "large" };
    if (RibbonCommands.isMenuName(from)) { item.menuFrom = from; } else { item.dropdown = from; }
    for (var k in o) { if (o.hasOwnProperty(k)) { item[k] = o[k]; } }
    return item;
};

/** A column of small buttons. */
RibbonCommands.stack = function(items) {
    for (var i = 0; i < items.length; i++) { items[i].size = "small"; }
    return { type: "stack", items: items };
};

RibbonCommands.small = function(file, o) {
    var item = RibbonCommands.cmd(file, o);
    item.size = "small";
    return item;
};

RibbonCommands.smallSplit = function(file, from, o) {
    var item = RibbonCommands.split(file, from, o);
    item.size = "small";
    return item;
};

/** Small buttons for every command of a menu, three to a column. */
RibbonCommands.columnsOf = function(menuName) {
    var list = Ribbon.actionsOf(menuName);
    var cols = [];
    for (var i = 0; i < list.length; i += 3) {
        var col = [];
        for (var j = i; j < Math.min(i + 3, list.length); j++) {
            col.push({ type: "button", action: list[j].file, size: "small" });
        }
        cols.push({ type: "stack", items: col });
    }
    return cols;
};

/**
 * What the selection holds, for the tabs that follow it (ctx.selection).
 *
 *     { count, kinds: { scan: n, shaped: n, other: n }, kind: "scan" | "shaped" | "other" | "mixed", ids: { scan: [ids], ... } }
 *
 * or undefined when nothing is selected. It queries every selected entity, so LayoutTabs
 * calls it on the selection-change signal and caches the answer; never from the poll.
 * A selection past LIMIT entities is classed by its first LIMIT (`truncated` says so).
 */
RibbonCommands.SELECTION_LIMIT = 500;

RibbonCommands.classifySelection = function(doc) {
    if (isNull(doc)) { return undefined; }
    var all = doc.querySelectedEntities();
    if (isNull(all) || all.length === 0) { return undefined; }
    var out = { count: all.length, kinds: {}, ids: {}, truncated: all.length > RibbonCommands.SELECTION_LIMIT };
    var n = Math.min(all.length, RibbonCommands.SELECTION_LIMIT);
    var haveTags = (typeof CsTags !== "undefined" && typeof CsShapeLine !== "undefined");
    var haveSymbols = (typeof CsSymbols !== "undefined");
    RibbonCommands.customNames = undefined;     // the caver's own symbols are re-read for each classification
    var haveCallout = (typeof CsTags !== "undefined" && typeof CsCallout !== "undefined");
    for (var i = 0; i < n; i++) {
        var e = doc.queryEntity(all[i]);
        if (isNull(e)) { continue; }
        var kind = "other";
        if (e.getType() === RS.EntityImage) {
            kind = "scan";
        }
        else if (haveTags && (CsTags.get(e, CsShapeLine.KEY.ID) !== "" || CsTags.get(e, CsShapeLine.KEY.DECOR) !== "")) {
            kind = "shaped";
        }
        else if (haveTags && CsTags.get(e, "Station") !== "") {
            kind = "station";
        }
        else if (haveTags && (CsTags.get(e, "From") !== "" || CsTags.get(e, "Splay") !== "")) {
            kind = "shot";
        }
        else if (haveCallout && CsTags.get(e, CsCallout.KEY.ID) !== "") {
            kind = (CsTags.get(e, CsCallout.KEY.KIND) === CsCallout.KIND_SECTION && CsTags.get(e, CsCallout.KEY.ROLE) === CsCallout.ROLE_BLOCK) ? "section" : "callout";
        }
        else if (haveSymbols && e.getType() === RS.EntityBlockRef) {
            var bname = "";
            try { bname = String(e.getReferencedBlockName()); } catch (eName) { }
            if (bname !== "" && (CsSymbols.byBlock(bname) !== null || RibbonCommands.customSymbolNames()[bname] === true)) {
                kind = "symbol";
                out.symbolNames = out.symbolNames || [];
                out.symbolNames.push(bname);
            }
        }
        out.kinds[kind] = (out.kinds[kind] || 0) + 1;
        if (isNull(out.ids[kind])) { out.ids[kind] = []; }
        out.ids[kind].push(all[i]);
    }
    // area fills: a boundary or its fill (an "other" entity until the area engine says so)
    if (typeof CsArea !== "undefined" && !isNull(out.ids.other)) {
        try {
            var areas = CsArea.resolveSelection(doc, out.ids.other);
            if (areas.length > 0) {
                out.kinds.area = areas.length;
                out.ids.area = areas;
            }
        }
        catch (eArea) {
        }
    }
    var present = [];
    for (var k in out.kinds) { if (out.kinds.hasOwnProperty(k)) { present.push(k); } }
    out.kind = present.length === 1 ? present[0] : "mixed";
    return out;
};

/** Block names of the caver's own symbols (read once per classification, and only if a block reference needs it). */
RibbonCommands.customSymbolNames = function() {
    if (isNull(RibbonCommands.customNames)) {
        var names = {};
        try {
            var list = CsSymbols.merged().entries;
            for (var i = 0; i < list.length; i++) { names[list[i].block] = true; }
        }
        catch (e) {
        }
        RibbonCommands.customNames = names;
    }
    return RibbonCommands.customNames;
};

/** True when the context's selection holds at least one entity of `kind`. */
RibbonCommands.selects = function(ctx, kind) {
    return !isNull(ctx.selection) && (ctx.selection.kinds[kind] || 0) > 0;
};

/** Starts a script-file action that has no menu entry (one the ribbon cannot look up by file). */
RibbonCommands.runByScript = function(path) {
    var a = isNull(path) ? undefined : RGuiAction.getByScriptFile(path);
    if (isNull(a)) { return false; }
    a.slotTrigger();
    return true;
};

RibbonCommands.register = function() {
    if (RibbonCommands.registered === true) {
        return;
    }
    RibbonCommands.registered = true;
    var C = RibbonCommands.cmd;
    var S = RibbonCommands.split;
    var M = RibbonCommands.menu;
    var K = RibbonCommands.stack;
    var s = RibbonCommands.small;
    var ss = RibbonCommands.smallSplit;

    Ribbon.registerTab({ id: "home", title: qsTr("Home") });
    Ribbon.registerTab({ id: "insert", title: qsTr("Insert") });
    Ribbon.registerTab({ id: "annotate", title: qsTr("Annotate") });
    Ribbon.registerTab({ id: "view", title: qsTr("View") });
    Ribbon.registerTab({ id: "manage", title: qsTr("Manage") });
    Ribbon.registerTab({ id: "output", title: qsTr("Output") });

    // ---------------------------------------------------------------- Home
    Ribbon.registerPanel("home", { id: "h-file", title: qsTr("File"), order: 5, items: [
        K([ s("File/NewFile/NewFile.js"), s("File/OpenFile/OpenFile.js"), s("File/Save/Save.js") ]),
        K([ s("File/SaveAs/SaveAs.js"), s("File/CloseFile/CloseFile.js") ]) ] });
    Ribbon.registerPanel("home", { id: "h-draw", title: qsTr("Draw"), order: 10, items: [
        S("Draw/Line/Line2P/Line2P.js", "DrawLineMenu", { text: qsTr("Line") }),
        S("Draw/Circle/CircleCR/CircleCR.js", "DrawCircleMenu", { text: qsTr("Circle") }),
        K([ s("Draw/Polyline/DrawPolyline/DrawPolyline.js", { text: qsTr("Polyline") }),
            ss("Draw/Arc/Arc3P/Arc3P.js", "DrawArcMenu", { text: qsTr("Arc") }),
            ss("Draw/Shape/ShapeRectanglePP/ShapeRectanglePP.js", "DrawShapeMenu", { text: qsTr("Rectangle") }) ]),
        // behind the arrow
        K([ ss("Draw/Ellipse/EllipseCPP/EllipseCPP.js", "DrawEllipseMenu", { text: qsTr("Ellipse") }),
            s("Draw/Spline/SplineControlPoints/SplineControlPoints.js", { text: qsTr("Spline") }),
            s("Draw/Point/Point1P/Point1P.js", { text: qsTr("Point") }) ]),
        K([ s("Draw/Hatch/HatchFromSelection/HatchFromSelection.js", { text: qsTr("Hatch") }),
            s("Draw/Text/Text.js", { text: qsTr("Text") }) ]),
        M("MiscDrawMenu", { text: qsTr("More\ndraw"), icon: "rect-viewport" }) ] });
    Ribbon.registerPanel("home", { id: "h-modify", title: qsTr("Modify"), order: 20, items: [
        C("Modify/Translate/Translate.js", { text: qsTr("Move") }),
        K([ s("Modify/Rotate/Rotate.js"), s("Modify/Mirror/Mirror.js"), s("Modify/Scale/Scale.js") ]),
        K([ ss("Modify/Trim/Trim.js", [ "Modify/Trim/Trim.js", "Modify/TrimBoth/TrimBoth.js", "Modify/AutoTrim/AutoTrim.js" ]),
            ss("Modify/Offset/Offset.js", [ "Modify/Offset/Offset.js", "Modify/OffsetThrough/OffsetThrough.js" ], { text: qsTr("Offset") }),
            ss("Modify/Round/Round.js", [ "Modify/Round/Round.js", "Modify/Bevel/Bevel.js" ], { text: qsTr("Fillet") }) ]),
        // behind the arrow
        K([ s("Modify/Stretch/Stretch.js"), s("Modify/Explode/Explode.js"),
            ss("Modify/BreakOut/BreakOut.js", [ "Modify/BreakOut/BreakOut.js", "Modify/BreakOutManual/BreakOutManual.js", "Modify/BreakOutGap/BreakOutGap.js", "Modify/Divide/Divide.js" ], { text: qsTr("Break") }) ]),
        K([ s("Modify/Lengthen/Lengthen.js", { text: qsTr("Lengthen") }), s("Modify/FlipHorizontal/FlipHorizontal.js"), s("Modify/FlipVertical/FlipVertical.js") ]),
        K([ s("Modify/DrawOrder/ToFront/ToFront.js", { text: qsTr("Bring to front") }), s("Modify/DrawOrder/ToBack/ToBack.js", { text: qsTr("Send to back") }) ]),
        M("ModifyMenu", { text: qsTr("All\nmodify"), icon: "layers" }) ] });
    Ribbon.registerPanel("home", { id: "h-annotation", title: qsTr("Annotation"), order: 30, items: [
        S("Draw/Dimension/DimAligned/DimAligned.js", "DimensionMenu", { text: qsTr("Dimension") }),
        K([ s("Draw/Dimension/Leader/Leader.js"), s("Modify/EditText/EditText.js"), s("Modify/EditHatch/EditHatch.js") ]) ] });
    Ribbon.registerPanel("home", { id: "h-layers", title: qsTr("Layers"), order: 40, items: [
        C("Widgets/LayerManager/LayerManager.js", { text: qsTr("Layer\nmanager") }),
        K([ s("Layer/AddLayer/AddLayer.js"), s("Layer/EditLayer/EditLayer.js"), s("Layer/ToggleLayerVisibility/ToggleLayerVisibility.js", { text: qsTr("Visibility") }) ]),
        K([ s("Layer/ShowAllLayers/ShowAllLayers.js", { text: qsTr("Show all") }), s("Layer/ShowActiveLayer/ShowActiveLayer.js", { text: qsTr("Only active") }), s("Layer/UnlockAllLayers/UnlockAllLayers.js", { text: qsTr("Unlock all") }) ]),
        K([ s("Layer/HideAllLayers/HideAllLayers.js", { text: qsTr("Hide all") }), s("Layer/LockAllLayers/LockAllLayers.js", { text: qsTr("Lock all") }), s("Layer/ToggleLayerLock/ToggleLayerLock.js", { text: qsTr("Toggle lock") }) ]),
        K([ s("Layer/SelectLayer/SelectLayer.js", { text: qsTr("Select entities") }), s("Layer/DeselectLayer/DeselectLayer.js", { text: qsTr("Deselect entities") }), s("Layer/RemoveLayer/RemoveLayer.js", { text: qsTr("Delete layer") }) ]) ] });
    Ribbon.registerPanel("home", { id: "h-precision", title: qsTr("Precision"), order: 60, items: [
        M("SnapMenu", { text: qsTr("Snaps"), icon: "square" }),
        S("Snap/RestrictOrthogonal/RestrictOrthogonal.js", [ "Snap/RestrictOff/RestrictOff.js", "Snap/RestrictOrthogonal/RestrictOrthogonal.js", "Snap/RestrictHorizontal/RestrictHorizontal.js",
            "Snap/RestrictVertical/RestrictVertical.js", "Snap/RestrictAngleLength/RestrictAngleLength.js" ], { text: qsTr("Restrict") }),
        K([ s("View/ToggleGrid/ToggleGrid.js", { text: qsTr("Grid") }),
            ss("Information/InfoDistancePP/InfoDistancePP.js", [ "InformationMenu", "MiscInformationMenu" ], { text: qsTr("Measure") }) ]) ] });
    Ribbon.registerPanel("home", { id: "h-clipboard", title: qsTr("Clipboard"), order: 80, items: [
        C("Edit/Paste/Paste.js"),
        K([ s("Edit/Cut/Cut.js"), s("Edit/Copy/Copy.js"), s("Edit/Duplicate/Duplicate.js") ]),
        K([ s("Edit/Delete/Delete.js") ]),
        K([ s("Edit/CopyWithReference/CopyWithReference.js", { text: qsTr("Copy with ref.") }), s("Edit/CutWithReference/CutWithReference.js", { text: qsTr("Cut with ref.") }) ]) ] });

    // -------------------------------------------------------------- Insert
    Ribbon.registerPanel("insert", { id: "i-block", title: qsTr("Block"), order: 10, items: [
        C("Block/InsertBlock/InsertBlock.js"),
        C("Block/CreateBlock/CreateBlock.js", { text: qsTr("Create\nblock") }),
        K([ s("Block/EditBlock/EditBlock.js"), s("Block/AddBlock/AddBlock.js", { text: qsTr("New block") }), s("Block/RenameBlock/RenameBlock.js", { text: qsTr("Rename") }) ]),
        K([ s("Block/RemoveBlock/RemoveBlock.js", { text: qsTr("Remove") }), s("Block/ShowAllBlocks/ShowAllBlocks.js"), s("Block/HideAllBlocks/HideAllBlocks.js") ]),
        K([ s("Block/EditMainDrawing/EditMainDrawing.js"), s("Block/EditFromReference/EditFromReference.js"), s("Block/ToggleBlockVisibility/ToggleBlockVisibility.js") ]),
        K([ s("Block/SelectBlockReferences/SelectBlockReferences.js"), s("Block/DeselectBlockReferences/DeselectBlockReferences.js") ]),
        M("MiscBlockMenu", { text: qsTr("Block\nlists"), icon: "sheet" }) ] });
    Ribbon.registerPanel("insert", { id: "i-reference", title: qsTr("Import"), order: 20, items: [
        C("Draw/Image/Image.js", { text: qsTr("Image") }),
        C("File/ImportFile/ImportFile.js", { text: qsTr("Import\ndrawing") }),
        C("File/SvgImport/SvgImport.js", { text: qsTr("Import\nSVG") }) ] });

    // ------------------------------------------------------------- Annotate
    Ribbon.registerPanel("annotate", { id: "a-text", title: qsTr("Text"), order: 10, items: [
        C("Draw/Text/Text.js"), C("Modify/EditText/EditText.js", { text: qsTr("Edit\ntext") }) ] });
    Ribbon.registerPanel("annotate", { id: "a-dim", title: qsTr("Dimensions"), order: 20, items: [
        S("Draw/Dimension/DimAligned/DimAligned.js", "DimensionMenu", { text: qsTr("Dimension") }),
        K([ s("Draw/Dimension/DimAligned/DimAligned.js"), s("Draw/Dimension/DimRotated/DimRotated.js"), s("Draw/Dimension/DimAngular/DimAngular.js") ]),
        K([ s("Draw/Dimension/DimRadial/DimRadial.js"), s("Draw/Dimension/DimDiametric/DimDiametric.js"), s("Draw/Dimension/DimOrdinate/DimOrdinate.js") ]),
        C("Draw/Dimension/Leader/Leader.js"), C("Draw/Dimension/DimRegen/DimRegen.js", { text: qsTr("Reset\nlabels") }) ] });
    Ribbon.registerPanel("annotate", { id: "a-hatch", title: qsTr("Hatch"), order: 30, items: [
        C("Draw/Hatch/HatchFromSelection/HatchFromSelection.js", { text: qsTr("Hatch") }), C("Modify/EditHatch/EditHatch.js", { text: qsTr("Edit\nhatch") }) ] });

    // ----------------------------------------------------------------- View
    Ribbon.registerPanel("view", { id: "v-zoom", title: qsTr("Zoom"), order: 10, items: [
        C("View/Zoom/ZoomIn/ZoomIn.js"), C("View/Zoom/ZoomOut/ZoomOut.js"),
        K([ s("View/Zoom/WindowZoom/WindowZoom.js", { text: qsTr("Window") }), s("View/Zoom/ZoomToSelection/ZoomToSelection.js", { text: qsTr("Selection") }), s("View/Zoom/PreviousView/PreviousView.js") ]),
        K([ s("View/Zoom/AutoZoom/AutoZoom.js"), s("View/Zoom/PanZoom/PanZoom.js") ]) ] });
    Ribbon.registerPanel("view", { id: "v-display", title: qsTr("Display"), order: 20, items: [
        C("View/ToggleGrid/ToggleGrid.js", { text: qsTr("Grid") }),
        C("View/DraftMode/DraftMode.js", { text: qsTr("Draft\nmode") }),
        K([ s("View/AntialiasingMode/AntialiasingMode.js", { text: qsTr("Anti-aliasing") }),
            ss("View/IsometricView/IsometricGridOff/IsometricGridOff.js", [ "View/IsometricView/IsometricGridOff/IsometricGridOff.js", "View/IsometricView/IsometricGridTop/IsometricGridTop.js",
                "View/IsometricView/IsometricGridLeft/IsometricGridLeft.js", "View/IsometricView/IsometricGridRight/IsometricGridRight.js" ], { text: qsTr("Isometric") }) ]),
        K([ s("View/LinetypeMode/LinetypeMode.js", { text: qsTr("Screen linetypes") }), s("View/DisplayDistanceAngle/DisplayDistanceAngle.js", { text: qsTr("Distance/angle") }),
            s("Projection/IsometricProjection/IsoProject/IsoProject.js", { text: qsTr("Isometric projection") }) ]) ] });
    Ribbon.registerPanel("view", { id: "v-palettes", title: qsTr("Palettes"), order: 30, items: [
        C("Widgets/LayerManager/LayerManager.js", { text: qsTr("Layer\nmanager") }), C("Widgets/PropertyEditor/PropertyEditor.js", { text: qsTr("Properties") }),
        K([ s("Widgets/BlockList/BlockList.js"), s("Widgets/LayerList/LayerList.js"), s("Widgets/CommandLine/CommandLine.js") ]),
        K([ s("Widgets/StatusBar/StatusBar.js") ]) ] });
    Ribbon.registerPanel("view", { id: "v-windows", title: qsTr("Windows"), order: 40, items: [
        K([ s("Window/NextWindow/NextWindow.js"), s("Window/PreviousWindow/PreviousWindow.js"), s("Window/CloseAll/CloseAll.js") ]) ] });

    // --------------------------------------------------------------- Manage
    Ribbon.registerPanel("manage", { id: "m-prefs", title: qsTr("Preferences"), order: 10, items: [
        C("Edit/DrawingPreferences/DrawingPreferences.js", { text: qsTr("Drawing\npreferences") }),
        C("Edit/AppPreferences/AppPreferences.js", { text: qsTr("Application\npreferences") }),
        C("Edit/ConvertUnit/ConvertUnit.js", { text: qsTr("Convert\nunit") }) ] });
    Ribbon.registerPanel("manage", { id: "m-appearance", title: qsTr("Appearance"), order: 15, items: [
        { type: "button", id: "theme", text: qsTr("Theme"), icon: "square", size: "large",
          tooltip: qsTr("Choose the colours of the application, dark or light"),
          onClick: function(entry) { Theme.openChooser(entry.ribbonItems.theme); } } ] });
    Ribbon.registerPanel("manage", { id: "m-select", title: qsTr("Selection"), order: 20, items: [
        C("Select/SelectAll/SelectAll.js"), C("Select/DeselectAll/DeselectAll.js"),
        K([ s("Select/InvertSelection/InvertSelection.js", { text: qsTr("Invert") }), s("Select/SelectContour/SelectContour.js"), s("Select/SelectRectangle/SelectRectangle.js") ]),
        K([ s("Select/SelectLayerByEntity/SelectLayerByEntity.js"), s("Select/SelectIntersectedEntities/SelectIntersectedEntities.js") ]) ] });
    Ribbon.registerPanel("manage", { id: "m-help", title: qsTr("Help"), order: 30, items: [
        C("Help/FAQ/FAQ.js"),
        K([ s("Help/BrowseUserManual/BrowseUserManual.js", { text: qsTr("User manual") }), s("Help/CheckForUpdates/CheckForUpdates.js", { text: qsTr("Updates") }), s("Help/SendFeedback/SendFeedback.js", { text: qsTr("Send feedback") }) ]),
        C("Help/About/About.js") ] });
    Ribbon.registerPanel("manage", { id: "m-utilities", title: qsTr("Utilities"), order: 40, items: [
        M("MiscIOMenu", { text: qsTr("Data\nimport"), icon: "pdf" }),
        M("MiscModifyMenu", { text: qsTr("Drawing\nfix-ups"), icon: "layers" }),
        M("MiscSelectMenu", { text: qsTr("Select\nby") , icon: "square" }) ] });

    // --------------------------------------------------------------- Output
    Ribbon.registerPanel("output", { id: "o-print", title: qsTr("Print"), order: 10, items: [
        C("File/Print/Print.js"), C("File/PrintPreview/PrintPreview.js", { text: qsTr("Print\npreview") }),
        C("File/PrintCurrentView/PrintCurrentView.js", { text: qsTr("Print\nview") }) ] });
    Ribbon.registerPanel("output", { id: "o-export", title: qsTr("Export"), order: 20, items: [
        C("File/PdfExport/PdfExport.js", { text: qsTr("PDF") }), C("File/BitmapExport/BitmapExport.js", { text: qsTr("Bitmap") }) ] });

    // ---------------------------------------------------------- Cave Survey
    // grouped by the order a survey is worked: start, data, draw, check, style, publish.
    // Any survey command not placed below lands in "More tools" so nothing is lost.
    var cs = function(name) { return "CaveSurvey/" + name + "/" + name + ".js"; };
    var csUsed = {};
    var CS = function(name, o) { csUsed[name] = true; return C(cs(name), o); };
    var cs_ = function(name, o) { csUsed[name] = true; return s(cs(name), o); };
    Ribbon.registerTab({ id: "cave", title: qsTr("Cave Survey") });
    Ribbon.registerPanel("cave", { id: "c-start", title: qsTr("Get started"), order: 10, items: [
        CS("StartHere", { text: qsTr("Start\nhere") }),
        CS("CaveShelf", { text: qsTr("Caves") }),
        K([ cs_("CaveTemplate", { text: qsTr("New cave map") }), cs_("TeachingCave", { text: qsTr("Teaching cave") }), cs_("Handbook") ]) ] });
    Ribbon.registerPanel("cave", { id: "c-data", title: qsTr("Survey data"), order: 20, items: [
        CS("SurveyNotebook", { text: qsTr("Survey\nnotebook") }),
        K([ cs_("ImportCaveSurvey", { text: qsTr("Import survey") }), cs_("StationTable", { text: qsTr("Station table") }), cs_("SurveyStats", { text: qsTr("Statistics") }) ]),
        K([ cs_("EntranceLocation", { text: qsTr("Entrance") }), cs_("SurfaceData", { text: qsTr("Surface data") }) ]) ] });
    Ribbon.registerPanel("cave", { id: "c-draw", title: qsTr("Draw and trace"), order: 30, items: [
        CS("DrawPanel", { text: qsTr("Draw") }),
        CS("SketchScans", { text: qsTr("Sketch\nscans") }),
        K([ cs_("CrossSection", { text: qsTr("Cross section") }), cs_("GenerateProfile", { text: qsTr("Profile") }), cs_("ScatterBreakdown", { text: qsTr("Scatter") }) ]) ] });
    Ribbon.registerPanel("cave", { id: "c-check", title: qsTr("Check and repair"), order: 40, items: [
        CS("CheckMap", { text: qsTr("Check\nmap") }),
        CS("LoopErrors", { text: qsTr("Loop\nerrors") }),
        K([ cs_("AreaSync", { text: qsTr("Sync areas") }), cs_("RepairDrawing", { text: qsTr("Repair") }), cs_("ResetDrawing", { text: qsTr("Reset") }) ]) ] });
    Ribbon.registerPanel("cave", { id: "c-style", title: qsTr("Style and annotate"), order: 50, items: [
        C(cs("ShapedLines"), { text: qsTr("Decorate\nselection") }),
        CS("Callout"),
        K([ C("CaveSurvey/ShapedLines/WallEdging.js", { size: "small", text: qsTr("Wall edging") }), cs_("LinetypeMaker", { text: qsTr("Linetypes") }), cs_("BuildLegend", { text: qsTr("Legend") }) ]) ] });
    csUsed["ShapedLines"] = true;
    Ribbon.registerPanel("cave", { id: "c-publish", title: qsTr("Plan and publish"), order: 60, items: [
        CS("SheetSetup", { text: qsTr("Sheet\nsetup") }),
        CS("ExpeditionPlanner", { text: qsTr("Expedition\nplanner") }),
        K([ cs_("ExportCaveSurvey", { text: qsTr("Export") }), cs_("PackageCave", { text: qsTr("Package") }), cs_("Cave3D", { text: qsTr("3D view") }) ]) ] });
    // ---------------------------------------------------- Selection tabs
    // These follow what is selected (ctx.selection). They DUPLICATE the Cave Survey tab's verbs
    // (that tab stays the full index) and are not accented, so they show without taking focus
    // away from the tab you are working in.
    var hasSel = function(kind) { return function(ctx) { return RibbonCommands.selects(ctx, kind); }; };
    Ribbon.registerTab({ id: "sel-shaped", title: qsTr("Shaped Line"), when: hasSel("shaped") });
    Ribbon.registerPanel("sel-shaped", { id: "ss-edit", title: qsTr("Shaped line"), order: 10, items: [
        C("CaveSurvey/ShapedLines/ShapedFlip.js", { text: qsTr("Flip\nside") }),
        C("CaveSurvey/ShapedLines/ShapedSync.js", { text: qsTr("Sync\nshaped lines") }) ] });
    Ribbon.registerPanel("sel-shaped", { id: "ss-wall", title: qsTr("Walls"), order: 20, items: [
        C("CaveSurvey/ShapedLines/WallEdging.js", { text: qsTr("Wall\nedging") }) ] });
    Ribbon.registerTab({ id: "sel-scan", title: qsTr("Scan"), when: hasSel("scan") });
    Ribbon.registerPanel("sel-scan", { id: "sc-fit", title: qsTr("Fit to the map"), order: 10, items: [
        { type: "button", id: "scanAlign", text: qsTr("Align\nscan"), icon: "scale", size: "large",
          tooltip: qsTr("Match stations on the selected scan to the drawing"),
          onClick: function(entry, ctx) {
              var path = (typeof ScanAlign !== "undefined") ? ScanAlign.scriptPath : undefined;
              if (!RibbonCommands.runByScript(path)) { EAction.handleUserWarning(qsTr("Align Scan needs the Cave Survey tools (Sketch Scans).")); }
          } },
        C("Modify/Translate/Translate.js", { text: qsTr("Move") }),
        K([ s("Modify/Rotate/Rotate.js"), s("Modify/Scale/Scale.js"), s("Modify/Mirror/Mirror.js") ]) ] });
    Ribbon.registerPanel("sel-scan", { id: "sc-keep", title: qsTr("Keep scans right (all scans)"), order: 15, items: [
        { type: "button", id: "scanReanchor", text: qsTr("Re-anchor\nall scans"), icon: "back", size: "large",
          tooltip: qsTr("Move every scan with the survey so its stations stay matched"),
          onClick: function(entry, ctx) {
              if (typeof CsScanReanchor === "undefined") { EAction.handleUserWarning(qsTr("Re-anchor needs the Cave Survey tools.")); return; }
              var r = CsScanReanchor.run(entry.di.getDocument(), entry.di);
              EAction.handleUserMessage(qsTr("Scans: %1 moved, %2 already matched, %3 stale, %4 refused.").arg(r.moved).arg(r.matched).arg(r.stale).arg(r.refused));
          } },
        { type: "button", id: "scanRelink", text: qsTr("Relink\nall scans"), icon: "duplicate", size: "large",
          tooltip: qsTr("Point every scan image at its file again (save the drawing afterwards)"),
          onClick: function(entry, ctx) {
              if (typeof CsScanRelink === "undefined") { EAction.handleUserWarning(qsTr("Relink needs the Cave Survey tools.")); return; }
              EAction.handleUserMessage(CsScanRelink.summary(CsScanRelink.run(entry.di.getDocument(), entry.di)));
          } } ] });
    Ribbon.registerPanel("sel-scan", { id: "sc-more", title: qsTr("Scans"), order: 20, items: [
        C(cs("SketchScans"), { text: qsTr("Sketch scans\npanel") }) ] });

    Ribbon.registerTab({ id: "sel-callout", title: qsTr("Callout"), when: hasSel("callout") });
    Ribbon.registerPanel("sel-callout", { id: "co-edit", title: qsTr("Callout"), order: 10, items: [
        C(cs("Callout"), { text: qsTr("Callout\npanel") }),
        { type: "button", id: "calloutReflow", text: qsTr("Reflow\nselected"), icon: "back", size: "large",
          tooltip: qsTr("Re-place the selected callouts' text and leaders"),
          onClick: function(entry, ctx) {
              if (typeof CsCalloutSync === "undefined") { EAction.handleUserWarning(qsTr("Reflow needs the Cave Survey tools.")); return; }
              EAction.handleUserMessage(CsCalloutSync.run(entry.di.getDocument(), entry.di));
          } } ] });
    Ribbon.registerTab({ id: "sel-section", title: qsTr("Cross Section"), when: hasSel("section") });
    Ribbon.registerPanel("sel-section", { id: "se-edit", title: qsTr("Cross section"), order: 10, items: [
        { type: "button", id: "sectionReopen", text: qsTr("Reopen in\nthe bay"), icon: "rename", size: "large",
          tooltip: qsTr("Put the selected cross section back into its bay to edit it (one undo step)"),
          onClick: function(entry, ctx) {
              if (typeof SectionEdit === "undefined") { EAction.handleUserWarning(qsTr("Reopen needs the Cave Survey tools (Cross Section).")); return; }
              SectionEdit.run();
          } },
        C(cs("CrossSection"), { text: qsTr("Cross section\ntool") }) ] });
    Ribbon.registerTab({ id: "sel-area", title: qsTr("Area Fill"), when: hasSel("area") });
    Ribbon.registerPanel("sel-area", { id: "ar-edit", title: qsTr("Area fill"), order: 10, items: [
        C(cs("AreaFill"), { text: qsTr("Area fill\npanel") }),
        C(cs("AreaSync"), { text: qsTr("Sync\nareas") }) ] });

    Ribbon.registerTab({ id: "sel-station", title: qsTr("Station"), when: hasSel("station") });
    Ribbon.registerPanel("sel-station", { id: "st-use", title: qsTr("Survey station"), order: 10, items: [
        C(cs("DrawPanel"), { text: qsTr("Draw from\nhere") }),
        C(cs("StationTable"), { text: qsTr("Station\ntable") }),
        C(cs("LoopErrors"), { text: qsTr("Loop\nerrors") }),
        C(cs("EntranceLocation"), { text: qsTr("Entrance") }) ] });

    Ribbon.registerTab({ id: "sel-symbol", title: qsTr("Symbol"), when: hasSel("symbol") });
    Ribbon.registerPanel("sel-symbol", { id: "sy-use", title: qsTr("Symbol"), order: 10, items: [
        C(cs("SymbolPalette"), { text: qsTr("Symbol\npalette") }),
        { type: "button", id: "symbolEdit", text: qsTr("Edit\nsymbol"), icon: "rename", size: "large",
          tooltip: qsTr("Open the selected symbol in the symbol editor (your own symbols only)"),
          onClick: function(entry, ctx) {
              if (typeof SymbolPaletteEdit === "undefined" || typeof CsSymbols === "undefined") { EAction.handleUserWarning(qsTr("Edit symbol needs the Cave Survey tools.")); return; }
              var name = (!isNull(ctx.selection) && !isNull(ctx.selection.symbolNames)) ? ctx.selection.symbolNames[0] : "";
              var list = CsSymbols.merged().entries;
              for (var i = 0; i < list.length; i++) {
                  if (list[i].block === name) { SymbolPaletteEdit.startEdit(list[i]); return; }
              }
          } } ] });
    Ribbon.registerTab({ id: "sel-shot", title: qsTr("Survey Shot"), when: hasSel("shot") });
    Ribbon.registerPanel("sel-shot", { id: "sh-use", title: qsTr("Survey shot"), order: 10, items: [
        C(cs("SurveyNotebook"), { text: qsTr("Survey\nnotebook") }),
        C(cs("StationTable"), { text: qsTr("Station\ntable") }),
        C(cs("LoopErrors"), { text: qsTr("Loop\nerrors") }),
        C(cs("DrawPanel"), { text: qsTr("Draw") }) ] });

    // ---- sheet furniture: the cave layout commands belong on a sheet, so they sit in the Layout tab
    var onSheet = function(ctx) { return ctx.mode === "layout"; };
    var L = function(name, text) { csUsed[name] = true; return C(cs(name), { text: text, enabled: onSheet }); };
    Ribbon.registerPanel("layout", { id: "cave-sheet", title: qsTr("Cave sheet"), order: 40, items: [
        L("LayoutBorder", qsTr("Border")), L("LayoutTitleBlock", qsTr("Title\nblock")),
        L("LayoutNorthArrow", qsTr("North\narrow")), L("LayoutScaleBar", qsTr("Scale\nbar")),
        L("LayoutLegend", qsTr("Legend")), L("LayoutGrid", qsTr("Grid")), L("LayoutIndex", qsTr("Index")),
        L("LayoutCheck", qsTr("Check\nsheet")), L("LayoutPlot", qsTr("Plot")) ] });
    // fitting a viewport to the cave map follows the selected viewport
    var onViewport = function(ctx) { return !isNull(ctx.viewport); };
    var V = function(name, text) { csUsed[name] = true; return C(cs(name), { text: text, enabled: onViewport }); };
    Ribbon.registerPanel("viewport", { id: "cave-fit", title: qsTr("Fit to the cave"), order: 60, items: [
        V("LayoutMatchViewport", qsTr("Match\nviewport")), V("LayoutZoomViewport", qsTr("Zoom\nviewport")) ] });

    RibbonCommands.sweepOnce = true;
    // whatever the survey suite adds later still shows up
    var leftovers = [];
    var all = Ribbon.actionsOf("CaveSurveyMenu");
    for (var li = 0; li < all.length; li++) {
        var base = all[li].file.replace(/^.*\/CaveSurvey\//, "");
        var key = base.split("/")[0];
        if (csUsed[key] !== true && base.indexOf("WallEdging.js") < 0) { leftovers.push(all[li]); }
    }
    if (leftovers.length > 0) {
        var more = [];
        for (var mi = 0; mi < leftovers.length; mi += 3) {
            var col = [];
            for (var mj = mi; mj < Math.min(mi + 3, leftovers.length); mj++) {
                col.push({ type: "button", action: leftovers[mj].file, size: "small" });
            }
            more.push({ type: "stack", items: col });
        }
        Ribbon.registerPanel("cave", { id: "c-more", title: qsTr("More tools"), order: 90, items: more });
    }
};

/**
 * Commands that are deliberately NOT on a tab, and why. Everything else with a menu entry
 * must be on one (a button, a dropdown, or behind a panel's arrow): sweep() names any that is not.
 */
RibbonCommands.EXCLUDED = [
    { file: "Reset/Reset.js", why: "the idle tool; Escape and the Select tool do this" },
    { file: "Edit/Esc/Esc.js", why: "the Escape key" },
    { file: "View/CommandLineFocus/CommandLineFocus.js", why: "moves keyboard focus, no ribbon use" },
    { file: "View/ToolMatrixFocus/ToolMatrixFocus.js", why: "moves keyboard focus, no ribbon use" },
    { file: "scripts/Widgets/LayerManager/LayerManager.js", why: "second copy of the Layer Manager (the per-user folder's), same tool as the one on Home" }
];

/** Commands the ribbon offers by other means than a tab button. */
RibbonCommands.ELSEWHERE = [
    { file: "Edit/Undo/Undo.js", where: "undo arrow right of the tabs" },
    { file: "Edit/Redo/Redo.js", where: "redo arrow right of the tabs" },
    { file: "Layouts/NewViewport/NewViewport.js", where: "Layout tab, New viewport" }
];

/**
 * Checks that every real command (one with a menu entry) has a home on the ribbon.
 * Returns { orphans: [{file, text}], placed, excluded, elsewhere }.
 */
RibbonCommands.sweep = function() {
    var placed = Ribbon.placedFiles();
    var list = Ribbon.commandIndex();
    var ends = function(file, suffix) { return file.length >= suffix.length && file.substring(file.length - suffix.length) === suffix; };
    var out = { orphans: [], placed: 0, excluded: 0, elsewhere: 0 };
    var seen = {};
    for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.menus.length === 0 || seen[c.file] === true) { continue; }
        seen[c.file] = true;
        if (!isNull(placed[c.file])) { out.placed++; continue; }
        var done = false;
        for (var e = 0; e < RibbonCommands.EXCLUDED.length && !done; e++) {
            if (ends(c.file, RibbonCommands.EXCLUDED[e].file)) { out.excluded++; done = true; }
        }
        for (var w = 0; w < RibbonCommands.ELSEWHERE.length && !done; w++) {
            if (ends(c.file, RibbonCommands.ELSEWHERE[w].file)) { out.elsewhere++; done = true; }
        }
        if (!done) { out.orphans.push({ file: c.file, text: c.text }); }
    }
    return out;
};

/** Logs any command without a home; called once the ribbon has been registered. */
RibbonCommands.checkSweep = function() {
    try {
        var r = RibbonCommands.sweep();
        if (r.orphans.length > 0) {
            var names = [];
            for (var i = 0; i < r.orphans.length; i++) { names.push(r.orphans[i].text); }
            qWarning("Ribbon: " + r.orphans.length + " command(s) are on no tab: " + names.join("; "));
        }
    }
    catch (e) {
        qWarning("Ribbon sweep: " + e);
    }
};
