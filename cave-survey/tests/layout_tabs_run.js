/** Smoke: LayoutTabs loads and its pieces exist (the GUI itself is checked live). */
include("scripts/library.js");
include("scripts/Widgets/LayoutTabs/LayoutTabs.js");
var ok = typeof LayoutTabs.attach === "function" && typeof LayoutCanvas.update === "function";
print(ok ? "### LAYOUT TABS LOAD OK" : "### LAYOUT TABS FAILED");
QCoreApplication.exit(ok ? 0 : 1);
