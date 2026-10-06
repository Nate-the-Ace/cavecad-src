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

/** A button for the command in `file`; `o` adds size, text, icon ... */
RibbonCommands.cmd = function(file, o) {
    var item = { type: "button", action: file, size: "large" };
    for (var k in o) { if (o.hasOwnProperty(k)) { item[k] = o[k]; } }
    return item;
};

/** A split button: `file` runs, the arrow lists `menuFrom` (a menu name) or `dropdown` (script files). */
RibbonCommands.split = function(file, from, o) {
    var item = { type: "button", action: file, size: "large" };
    if (typeof from === "string") { item.menuFrom = from; } else { item.dropdown = from; }
    for (var k in o) { if (o.hasOwnProperty(k)) { item[k] = o[k]; } }
    return item;
};

/** A dropdown with no main command of its own. */
RibbonCommands.menu = function(from, o) {
    var item = { type: "button", size: "large" };
    if (typeof from === "string") { item.menuFrom = from; } else { item.dropdown = from; }
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
        K([ s("File/NewFile/NewFile.js"), s("File/OpenFile/OpenFile.js"), s("File/Save/Save.js") ]) ] });
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
            s("Draw/Text/Text.js", { text: qsTr("Text") }) ]) ] });
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
        M("ModifyMenu", { text: qsTr("All\nmodify"), icon: "layers" }) ] });
    Ribbon.registerPanel("home", { id: "h-annotation", title: qsTr("Annotation"), order: 30, items: [
        S("Draw/Dimension/DimAligned/DimAligned.js", "DimensionMenu", { text: qsTr("Dimension") }),
        K([ s("Draw/Dimension/Leader/Leader.js"), s("Modify/EditText/EditText.js"), s("Modify/EditHatch/EditHatch.js") ]) ] });
    Ribbon.registerPanel("home", { id: "h-layers", title: qsTr("Layers"), order: 40, items: [
        C("Widgets/LayerManager/LayerManager.js", { text: qsTr("Layer\nmanager") }),
        K([ s("Layer/AddLayer/AddLayer.js"), s("Layer/EditLayer/EditLayer.js"), s("Layer/ToggleLayerVisibility/ToggleLayerVisibility.js", { text: qsTr("Visibility") }) ]),
        K([ s("Layer/ShowAllLayers/ShowAllLayers.js", { text: qsTr("Show all") }), s("Layer/ShowActiveLayer/ShowActiveLayer.js", { text: qsTr("Only active") }), s("Layer/UnlockAllLayers/UnlockAllLayers.js", { text: qsTr("Unlock all") }) ]) ] });
    Ribbon.registerPanel("home", { id: "h-precision", title: qsTr("Precision"), order: 60, items: [
        M("SnapMenu", { text: qsTr("Snaps"), icon: "square" }),
        S("Snap/RestrictOrthogonal/RestrictOrthogonal.js", [ "Snap/RestrictOff/RestrictOff.js", "Snap/RestrictOrthogonal/RestrictOrthogonal.js", "Snap/RestrictHorizontal/RestrictHorizontal.js",
            "Snap/RestrictVertical/RestrictVertical.js", "Snap/RestrictAngleLength/RestrictAngleLength.js" ], { text: qsTr("Restrict") }),
        K([ s("View/ToggleGrid/ToggleGrid.js", { text: qsTr("Grid") }),
            ss("Information/InfoDistancePP/InfoDistancePP.js", "InformationMenu", { text: qsTr("Measure") }) ]) ] });
    Ribbon.registerPanel("home", { id: "h-clipboard", title: qsTr("Clipboard"), order: 80, items: [
        C("Edit/Paste/Paste.js"),
        K([ s("Edit/Cut/Cut.js"), s("Edit/Copy/Copy.js"), s("Edit/Duplicate/Duplicate.js") ]),
        K([ s("Edit/Undo/Undo.js"), s("Edit/Redo/Redo.js"), s("Edit/Delete/Delete.js") ]) ] });

    // -------------------------------------------------------------- Insert
    Ribbon.registerPanel("insert", { id: "i-block", title: qsTr("Block"), order: 10, items: [
        C("Block/InsertBlock/InsertBlock.js"),
        C("Block/CreateBlock/CreateBlock.js", { text: qsTr("Create\nblock") }),
        K([ s("Block/EditBlock/EditBlock.js"), s("Block/AddBlock/AddBlock.js", { text: qsTr("New block") }), s("Block/RenameBlock/RenameBlock.js", { text: qsTr("Rename") }) ]),
        K([ s("Block/RemoveBlock/RemoveBlock.js", { text: qsTr("Remove") }), s("Block/ShowAllBlocks/ShowAllBlocks.js"), s("Block/HideAllBlocks/HideAllBlocks.js") ]),
        K([ s("Block/EditMainDrawing/EditMainDrawing.js") ]) ] });
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
                "View/IsometricView/IsometricGridLeft/IsometricGridLeft.js", "View/IsometricView/IsometricGridRight/IsometricGridRight.js" ], { text: qsTr("Isometric") }) ]) ] });
    Ribbon.registerPanel("view", { id: "v-palettes", title: qsTr("Palettes"), order: 30, items: [
        C("Widgets/LayerManager/LayerManager.js", { text: qsTr("Layer\nmanager") }), C("Widgets/PropertyEditor/PropertyEditor.js", { text: qsTr("Properties") }),
        K([ s("Widgets/BlockList/BlockList.js"), s("Widgets/LayerList/LayerList.js"), s("Widgets/CommandLine/CommandLine.js") ]) ] });
    Ribbon.registerPanel("view", { id: "v-windows", title: qsTr("Windows"), order: 40, items: [
        K([ s("Window/NextWindow/NextWindow.js"), s("Window/PreviousWindow/PreviousWindow.js"), s("Window/CloseAll/CloseAll.js") ]) ] });

    // --------------------------------------------------------------- Manage
    Ribbon.registerPanel("manage", { id: "m-prefs", title: qsTr("Preferences"), order: 10, items: [
        C("Edit/DrawingPreferences/DrawingPreferences.js", { text: qsTr("Drawing\npreferences") }),
        C("Edit/AppPreferences/AppPreferences.js", { text: qsTr("Application\npreferences") }),
        C("Edit/ConvertUnit/ConvertUnit.js", { text: qsTr("Convert\nunit") }) ] });
    Ribbon.registerPanel("manage", { id: "m-select", title: qsTr("Selection"), order: 20, items: [
        C("Select/SelectAll/SelectAll.js"), C("Select/DeselectAll/DeselectAll.js"),
        K([ s("Select/InvertSelection/InvertSelection.js", { text: qsTr("Invert") }), s("Select/SelectContour/SelectContour.js"), s("Select/SelectRectangle/SelectRectangle.js") ]),
        K([ s("Select/SelectLayerByEntity/SelectLayerByEntity.js"), s("Select/SelectIntersectedEntities/SelectIntersectedEntities.js") ]) ] });
    Ribbon.registerPanel("manage", { id: "m-help", title: qsTr("Help"), order: 30, items: [
        C("Help/FAQ/FAQ.js"),
        K([ s("Help/BrowseUserManual/BrowseUserManual.js", { text: qsTr("User manual") }), s("Help/CheckForUpdates/CheckForUpdates.js", { text: qsTr("Updates") }), s("Help/SendFeedback/SendFeedback.js", { text: qsTr("Send feedback") }) ]),
        C("Help/About/About.js") ] });

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
