/**
 * Sheet settings tab (LayoutTabs.makeSheet*): the widgets are filled from the layout that is showing,
 * and editing one changes the sheet at once. Built without a window: the widgets are made here and
 * the parts of the tab strip that need a window are stubbed.
 */
include("scripts/library.js");
include("scripts/Layouts/Layouts.js");
include("scripts/Widgets/LayoutTabs/LayoutTabs.js");

var fails = 0;
/** Ends the run without letting the application tear itself down: after any widget has been made, a normal
 *  exit crashes in Qt's GL thread cleanup, and macOS shows its crash dialog. The result is already printed. */
function hardExit() {
    var p = new QProcess();
    // a moment's grace first, so everything printed has been written out
    p.setProgram("/bin/sh");
    p.setArguments(["-c", "sleep 2; kill -9 " + String(QCoreApplication.applicationPid())]);
    p.startDetached();
    QCoreApplication.exit(0);
}

function check(c, m) { if (!c) { fails++; print("### SHEET SETTINGS FAILED: " + m); } else print("ok: " + m); }
function near(a, b) { return Math.abs(a - b) < 0.01; }

function main() {
    var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexSimple());
    doc.setUnit(RS.Foot);
    var di = new RDocumentInterface(doc);
    Layouts.create(di, { name: "A1", paper: "Letter", landscape: true });
    Layouts.activate(di, "A1");

    // the tab strip and the canvas need a window; the sheet settings do not
    LayoutTabs.refresh = function(entry) {};
    LayoutCanvas.restoreOrFit = function(entry) {};
    LayoutTabs.refreshControls = function(entry) { LayoutTabs.refreshSheet(entry); };

    var entry = { di: di, id: 1 };
    var parent = new QWidget();
    LayoutTabs.makeSheetPaper(entry, parent);
    LayoutTabs.makeSheetCustom(entry, parent);
    LayoutTabs.makeSheetMargins(entry, parent);
    LayoutTabs.makeSheetPrint(entry, parent);
    var W = entry.sheetW;
    check(!isNull(W.paper) && !isNull(W.portrait) && !isNull(W.mTop) && !isNull(W.width) && !isNull(W.color), "all the sheet settings widgets are built");

    LayoutTabs.refreshSheet(entry);
    check(W.paper.currentText === "Letter", "paper size shows Letter: " + W.paper.currentText);
    check(W.landscape.checked === true && W.portrait.checked === false, "orientation shows landscape");
    check(W.units.currentIndex === 0, "units show inches");
    check(near(W.mTop.value, 0.25) && near(W.mLeft.value, 0.25), "margins show 0.25 in: " + W.mTop.value);
    check(W.preset.currentText.indexOf("Narrow") >= 0, "preset shows Narrow: " + W.preset.currentText);
    check(W.color.currentIndex === 0, "print colour shows full colour");

    // edit a margin: the sheet changes, and the widgets follow
    W.mTop.value = 0.5;
    var info = Layouts.get(doc, "A1");
    check(near(info.marginsMM.t, 12.7), "typing a top margin of 0.5 in sets the sheet: " + info.marginsMM.t + " mm");
    check(near(info.marginsMM.l, 6.35), "the other margins stay: " + info.marginsMM.l);
    check(W.preset.currentText.indexOf("Custom") === 0, "preset now says Custom: " + W.preset.currentText);

    // a preset sets all four
    LayoutTabs.sheetPresetPicked(entry, 4);   // Wide (0 Custom, 1 None, 2 Narrow, 3 Normal, 4 Wide)
    info = Layouts.get(doc, "A1");
    check(near(info.marginsMM.l, 25.4) && near(info.marginsMM.t, 25.4) && near(info.marginsMM.b, 25.4) && near(info.marginsMM.r, 25.4), "the Wide preset sets all four to 1 in");
    check(near(W.mRight.value, 1), "and the boxes show 1 in");

    // orientation and size
    W.portrait.click();
    info = Layouts.get(doc, "A1");
    check(info.paperMM.w < info.paperMM.h, "Portrait turns the sheet upright: " + info.paperMM.w + " x " + info.paperMM.h);
    var a3 = 0; for (var i = 0; i < W.paper.count; i++) { if (W.paper.itemText(i) === "A3") { a3 = i; } }
    LayoutTabs.sheetPaperPicked(entry, a3);
    info = Layouts.get(doc, "A1");
    check(near(Math.min(info.paperMM.w, info.paperMM.h), 297) && near(Math.max(info.paperMM.w, info.paperMM.h), 420), "choosing A3 sets 297 x 420 mm: " + info.paperMM.w + " x " + info.paperMM.h);

    // units change the boxes, not the paper
    W.units.setCurrentIndex(1);
    LayoutTabs.sheetApply(entry, { units: Layouts.MILLIMETERS });
    check(String(W.mTop.suffix()).indexOf("mm") >= 0 && near(W.mTop.value, 25.4), "millimetres: the boxes read 25.4 mm: " + W.mTop.value + W.mTop.suffix());

    // a custom size typed in
    W.width.value = 250;
    W.height.value = 400;
    info = Layouts.get(doc, "A1");
    check(near(Math.max(info.paperMM.w, info.paperMM.h), 400) && near(Math.min(info.paperMM.w, info.paperMM.h), 250), "a typed 250 x 400 mm paper is set: " + info.paperMM.w + " x " + info.paperMM.h);
    check(W.paper.itemText(0) === "Custom", "and the size list says Custom");

    // print colour
    LayoutTabs.sheetColorPicked(entry, 2);
    check(Layouts.getColorMode(doc, Layouts.get(doc, "A1")) === "BlackWhite", "print colour set to black and white");

    // a no-change edit pushes nothing onto the undo stack
    var last = doc.getStorage().getLastTransactionId();
    LayoutTabs.sheetApply(entry, { landscape: Layouts.get(doc, "A1").paperMM.w >= Layouts.get(doc, "A1").paperMM.h });
    check(doc.getStorage().getLastTransactionId() === last, "an edit that changes nothing adds no undo step");

    // the settings sit in the Layout tab itself, always there while a sheet is showing
    LayoutTabs.registerRibbon();
    var panels = Ribbon.panels["layout"];
    var group = null;
    for (var pi = 0; pi < panels.length; pi++) { if (panels[pi].id === "sheetsettings") { group = panels[pi]; } }
    check(group !== null && group.items.length === 4, "the Layout tab has a Sheet settings group of four columns");
    check(isNull(Ribbon.tabById("sheet")), "and there is no separate Sheet settings tab to open");
    var hasPageSetup = false;
    for (var qi = 0; qi < panels.length; qi++) {
        for (var ii = 0; ii < panels[qi].items.length; ii++) {
            var it = panels[qi].items[ii];
            if (it.id === "pagesetup") { hasPageSetup = true; }
            if (it.type === "stack") { for (var si = 0; si < it.items.length; si++) { if (it.items[si].id === "pagesetup") { hasPageSetup = true; } } }
        }
    }
    check(!hasPageSetup, "and no Page setup button to press");

    if (fails === 0) print("### SHEET SETTINGS OK");
    if (fails === 0) { hardExit(); } else { QCoreApplication.exit(1); }
}
main();
