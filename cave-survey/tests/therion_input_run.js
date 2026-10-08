// therion_input_run.js -- a split Therion project imports whole.
//
//   CaveCAD -no-dock-icon -no-gui -allow-multiple-instances \
//       -autostart tests/therion_input_run.js "$PWD"
//
// tests/js_unit.js pins `input` and `equate` with a fake file reader.
// This proves the real thing: the registry's QFile reader follows
// relative paths on disk (with and without the .th extension), and the
// equate in the main file joins stations across the included surveys.

var args = RSettings.getOriginalArguments();
var repoRoot = args[args.length - 1];

include("scripts/EAction.js");
include("scripts/simple.js");
includeBasePath = repoRoot + "/scripts/CaveSurvey/Core";
include(includeBasePath + "/CsAll.js");

var failures = [];
function ok(c, what) { if (!c) { failures.push(what); } }
function eqs(a, b, what) {
    ok(a === b, what + " (expected " + JSON.stringify(b) + ", got " +
        JSON.stringify(a) + ")");
}

var main = repoRoot + "/testdata/therion_project/main.th";
var file = new QFile(main);
ok(file.open(QIODevice.ReadOnly | QIODevice.Text), "fixture opens");
var content = String(new QTextStream(file).readAll());
file.close();

var format = CsFormatRegistry.detect(main, content);
ok(format !== null && format.id === "therion", "detected as Therion");

var alone = format.parse(content);
eqs(alone.shots.length, 0, "without a path the inputs cannot be followed");

var survey = format.parse(content, CsFormatRegistry.optionsFor(main));
eqs(survey.shots.length, 4, "both included files' legs arrive");
eqs(survey.caveName, "Split Cave", "the title comes from the main file");
eqs(survey.shots[0].from, "entrance.1", "an included survey keeps its own prefix");
eqs(survey.shots[1].to, "entrance.3", "the first listed station names the join");
eqs(survey.shots[3].to, "entrance.3",
    "the lower survey's station 3 IS the entrance series' station 3");
var finds = CsModel.parseFindings(survey);
eqs(finds.length, 0, "nothing is missing, so nothing is warned about (" +
    JSON.stringify(finds) + ")");

// a name that will not read is said out loud
var broken = content.replace("passages/lower.th", "passages/nowhere.th");
var bsurvey = format.parse(broken, CsFormatRegistry.optionsFor(main));
eqs(bsurvey.shots.length, 2, "the readable file still imports");
var bf = CsModel.parseFindings(bsurvey);
ok(bf.length >= 1 && bf[0].code === "therion-input-missing",
    "and the missing one is named");

if (failures.length === 0) {
    print("### THERION INPUT OK");
} else {
    print("### THERION INPUT FAIL " + failures.length);
    for (var i = 0; i < failures.length; i++) { print("  FAIL: " + failures[i]); }
}
