/**
 * Theme engine (Widgets/Theme): every colour and mode gives a full palette, the custom theme
 * is built from one highlight colour, and the application style sheet carries the marker QCAD
 * reads to pick light or dark toolbar icons. Pure functions only: nothing is saved or applied.
 * (The chooser's widgets and the colour dialog are checked in a running app: building them
 * here makes the headless run crash on exit.)
 */
include("scripts/library.js");
include("scripts/Widgets/Theme/Theme.js");

var fails = 0;
function check(c, m) { if (!c) { fails++; print("### THEME FAILED: " + m); } else print("ok: " + m); }
var HEX = /^#[0-9a-f]{6}$/;
var KEYS = ["bg", "head", "tab", "line", "hover", "field", "dim", "dim2", "text", "textStrong", "accent"];

function main() {
    check(Theme.PRESETS.length === 10, "ten colours on offer");
    var ids = Theme.PRESETS.map(function(p) { return p.id; }).concat(["custom"]);
    var allGood = true, bad = "";
    for (var i = 0; i < ids.length; i++) {
        var modes = ["dark", "light"];
        for (var m = 0; m < 2; m++) {
            var c = Theme.colors(modes[m], ids[i]);
            for (var k = 0; k < KEYS.length; k++) {
                if (!HEX.test(c[KEYS[k]])) { allGood = false; bad += " " + ids[i] + "/" + modes[m] + "/" + KEYS[k] + "=" + c[KEYS[k]]; }
            }
        }
    }
    check(allGood, "every colour, in dark and light, gives eleven valid #rrggbb colours" + bad);

    var lum = function(hex) { return (parseInt(hex.substring(1, 3), 16) + parseInt(hex.substring(3, 5), 16) + parseInt(hex.substring(5, 7), 16)) / 3; };
    var d = Theme.colors("dark", "forest"), l = Theme.colors("light", "forest");
    check(lum(d.bg) < 60 && lum(l.bg) > 220, "dark is dark and light is light: " + d.bg + " / " + l.bg);
    check(lum(d.text) > 200 && lum(l.text) < 60, "text contrasts with its background in both modes");
    check(d.accent === "#2fb86a" && l.accent === "#2fb86a", "a theme keeps its highlight in both modes");

    // the custom theme: one highlight colour is all that is picked
    check(Theme.hexToHsl("#ff0000").h === 0 && Math.abs(Theme.hexToHsl("#00ff00").h - 120) < 1 && Math.abs(Theme.hexToHsl("#0000ff").h - 240) < 1, "hue read from a colour");
    var back = Theme.hexToHsl(Theme.hsl(150, 0.6, 0.4));
    check(Math.abs(back.h - 150) < 2 && Math.abs(back.s - 0.6) < 0.02 && Math.abs(back.l - 0.4) < 0.02, "hsl and hex round trip: " + JSON.stringify(back));
    var cp = Theme.preset("custom");
    check(cp.id === "custom" && HEX.test(cp.accent) && cp.sat >= 0.12 && cp.sat <= 1, "custom preset is built from the saved highlight: " + cp.accent);
    var gray = Theme.hexToHsl("#808080");
    check(gray.s === 0, "a grey highlight has no saturation (the greys then stay neutral)");

    // the application style sheet
    var sd = Theme.sheet(d, true), sl = Theme.sheet(l, false);
    check(sd.indexOf("IconPostfix:inverse") >= 0 && sl.indexOf("IconPostfix:none") >= 0, "the sheet carries QCAD's light/dark icon marker");
    check(sd.indexOf(d.accent) >= 0 && sd.indexOf(d.bg) >= 0 && sl.indexOf(l.bg) >= 0, "and the palette's colours");
    check(sd.indexOf("QPushButton:flat") >= 0 && /QPushButton:flat \{[^}]*padding:0px 2px/.test(sd), "a flat push button (the 22 px '?' help button) has no side padding, so its label shows");
    check(sd.length > 3000 && sd.indexOf("QScrollBar") >= 0 && sd.indexOf("QMenu") >= 0 && sd.indexOf("QDockWidget") >= 0, "and rules for the main widgets");

    if (fails === 0) print("### THEME OK");
    QCoreApplication.exit(fails === 0 ? 0 : 1);
}
main();
