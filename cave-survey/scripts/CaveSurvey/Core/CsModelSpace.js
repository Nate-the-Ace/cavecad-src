// CsModelSpace.js -- the refusal every editing tool owes a SHEET.
//
// Part of the Cave Survey Core library.
//
// WHY. A cave map is drawn in MODEL SPACE; a sheet (a layout) is a piece of
// paper showing it. Every tool in this suite reads the cave and writes its
// result into whatever block is current -- which, with a layout showing, is
// the sheet. A traced passage or a regenerated profile would land on the
// PAPER, in paper-space coordinates, and look like nothing had happened
// (the viewport shows model space, not what was just added). So the tools
// that WRITE ask first, and say where the work belongs.
//
// Editing THROUGH a viewport puts the document in model space (see
// Widgets/LayoutTabs), so `blocks` lets it pass: tracing, symbols and the
// other hand-drawing tools are exactly what click-through is for. The tools
// that rebuild or rewrite the WHOLE drawing (import, redraw, regenerate,
// repair, reset, ...) use `blocksWhole` instead, which refuses that state
// too: the view is panned and zoomed to a viewport and its frame is
// pinned on screen, and a whole-drawing run would refit the view and write
// the result back into the viewport when the caver leaves.
//
// (This replaces CsSheetFile, which marked whole sheet FILES and refused
// them; sheets are layouts of the cave's own drawing now, and there is no
// such file to refuse.)

var CsModelSpace = {};

/** True when a layout (a sheet) is the block being worked in. */
CsModelSpace.onSheet = function(doc) {
    try {
        return !isNull(Layouts.current(doc));
    } catch (e) {
        return false;
    }
};

/**
 * What a tool says when it will not work on a sheet.
 *
 * ONE SENTENCE that answers the question the caver is actually asking,
 * which is not "why won't it" but "where do I do this then".
 */
CsModelSpace.refusal = function(toolName) {
    return toolName + ": a sheet is showing, and this works on the cave " +
        "itself.\n\nClick the Model tab (or double-click a viewport to " +
        "edit through it) and run it again.";
};

/**
 * The guard an editing tool runs first.
 *
 * \return true when the tool should STOP. Warns the caver itself, so a
 *         caller is one line: `if (CsModelSpace.blocks(doc, "Feature
 *         Trace")) { return; }`
 */
CsModelSpace.blocks = function(doc, toolName) {
    if (!CsModelSpace.onSheet(doc)) {
        return false;
    }
    try {
        CsTell.warn(CsModelSpace.refusal(toolName));
    } catch (eWarn) {
    }
    return true;
};


/** True when the window is "inside" a viewport: model space shown through its frame. */
CsModelSpace.inViewport = function() {
    try {
        var entry = LayoutTabs.entryOfActive();
        return !isNull(entry) && !isNull(entry.editing);
    } catch (e) {
        return false;
    }
};

/** What a whole-drawing tool says when the caver is inside a viewport. */
CsModelSpace.viewportRefusal = function(toolName) {
    return toolName + ": you are editing through a viewport, and this " +
        "works on the whole drawing.\n\nClick \"Back to layout\", then the " +
        "Model tab, and run it again.";
};

/**
 * The guard for a tool that works on the WHOLE drawing: refuses a sheet
 * (as `blocks`) and also the inside of a viewport.
 *
 * \return true when the tool should STOP; warns the caver itself.
 */
CsModelSpace.blocksWhole = function(doc, toolName) {
    if (CsModelSpace.inViewport()) {
        try {
            CsTell.warn(CsModelSpace.viewportRefusal(toolName));
        } catch (eWarn) {
        }
        return true;
    }
    return CsModelSpace.blocks(doc, toolName);
};
