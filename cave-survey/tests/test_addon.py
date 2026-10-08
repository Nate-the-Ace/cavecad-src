"""
Structural tests for the scripts/CaveSurvey/ QCAD add-on.

Almost none of this needs QCAD -- it's the layout and menu wiring that QCAD
relies on to find and order the tools. These failures are the miserable kind
to diagnose by hand: a tool that just isn't in the menu, an icon that renders
blank, or two tools whose order silently depends on load sequence. The one
exception is TestAddProfileLayersToolIdempotence, which shells out to CaveCAD
itself (~1s per invocation) because "run the one-shot tool twice and diff the
bytes" cannot be checked any other way; it skips itself when CaveCAD is not
installed at the expected path.

    python3 -m unittest discover -s tests -v

The syntax of each script is checked separately, inside QCAD's own engine, by
tests/js_syntax.js -- see tests/README.md.
"""

import hashlib
import json
import os
import re
import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ElementTree

# Some things are only required to ship, not to develop. A tool with no icon is
# perfectly usable from the menu and the command line while it's being written;
# it just can't go out that way. Those checks live in TestPublishReadiness and
# stay off by default -- see tests/README.md.
PUBLISH_CHECK = os.environ.get("CAVESURVEY_PUBLISH_CHECK") == "1"

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# By default these check the add-on as it sits in the repo. tools/make_package.sh
# points them at a staged package instead, so the same rules are enforced on what
# actually ships -- which is the only place AlignImage (a separate project, copied
# in at build time) is ever seen alongside the other tools. A sort order that only
# collides once AlignImage is present is exactly the kind of thing that has to fail
# there rather than in the repo.
ADDON = os.environ.get("CAVESURVEY_ADDON") or os.path.join(REPO, "scripts", "CaveSurvey")
TESTDATA = os.path.join(REPO, "testdata")
TEMPLATES = os.environ.get("CAVESURVEY_TEMPLATES") or os.path.join(REPO, "templates")

# The menu/toolbar object names created by CaveSurvey.js. A tool that doesn't
# reference both never appears in either place.
WIDGET_NAMES = ["CaveSurveyMenu", "CaveSurveyToolBar"]


# A folder is a TOOL if and only if it contains <Folder>.js. Folders
# without one are libraries (Core/) and are never init'd by QCAD.
LIBRARY_DIRS = {"Core", "Templates"}


def all_dirs():
    return sorted(
        name for name in os.listdir(ADDON)
        if os.path.isdir(os.path.join(ADDON, name))
        and not name.startswith(".")
    )


def tool_dirs():
    return [name for name in all_dirs()
            if os.path.exists(os.path.join(ADDON, name, name + ".js"))]


def tool_source(name):
    with open(os.path.join(ADDON, name, name + ".js")) as fh:
        return fh.read()


def tool_source_at(relpath):
    """Source of any add-on file by its path relative to ADDON -- for
    CaveSurvey.js itself, which tool_source() cannot reach (it is not
    <name>/<name>.js)."""
    with open(os.path.join(ADDON, relpath)) as fh:
        return fh.read()


def live_init_definition(source):
    """The object name X for a live (non-commented) "X.init = function"
    assignment in source, or None. Parsed line-by-line rather than
    grepped for the substring, same reason as
    test_every_core_file_is_included_by_csall below: a commented-out
    definition must not count as a tool registering itself."""
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        match = re.match(r'([A-Za-z_][A-Za-z0-9_]*)\.init\s*=\s*function',
                         stripped)
        if match:
            return match.group(1)
    return None


def live_includes(source):
    """Basenames of every live include(includeBasePath + "/...") target
    in source. Same live-line filtering as live_init_definition."""
    found = set()
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        match = re.search(r'include\(includeBasePath \+ "([^"]+)"\)',
                          stripped)
        if match:
            found.add(os.path.basename(match.group(1)))
    return found


def live_init_calls(source):
    """Object names X for every live "X.init(basePath)" call in source."""
    found = set()
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        for match in re.finditer(
                r'([A-Za-z_][A-Za-z0-9_]*)\.init\(basePath\)', stripped):
            found.add(match.group(1))
    return found


def live_install_calls(source):
    """Object names X for every live "X.install()" call in source. Same
    live-line filtering as live_init_calls -- a commented-out install()
    must not count as wiring."""
    found = set()
    for line in source.splitlines():
        stripped = line.strip()
        if stripped.startswith("//"):
            continue
        for match in re.finditer(
                r'([A-Za-z_][A-Za-z0-9_]*)\.install\(\)', stripped):
            found.add(match.group(1))
    return found


def sibling_tool_files(name):
    """(filename, initObjectName) for every .js file in a tool's own
    folder, other than <name>.js itself, that defines its own
    "<X>.init = function" -- i.e. registers its own RGuiAction and is
    therefore a second tool riding along in the same folder (ShapedLines'
    draw buttons are the live example; SketchSection's Capture/Edit
    companions were the one that shipped broken -- see
    TestSiblingToolsAreWired below -- before folding into CrossSection's
    own route dialog retired the pattern for this folder), not a plain
    library (CalloutWrite.js, ScanView.js, ...) that <name>.js merely
    calls into. Only these have a menu entry, toolbar button or command
    to lose if the folder's main file forgets to wire them up."""
    folder = os.path.join(ADDON, name)
    out = []
    for filename in sorted(os.listdir(folder)):
        if not filename.endswith(".js") or filename == name + ".js":
            continue
        with open(os.path.join(folder, filename)) as fh:
            source = fh.read()
        obj = live_init_definition(source)
        if obj is not None:
            out.append((filename, obj))
    return out


def find_int(source, call):
    match = re.search(re.escape(call) + r"\((\d+)\)", source)
    return int(match.group(1)) if match else None


# The icon file names a tool really registers. Matching the whole call
# rather than a bare "setIcon(" substring is deliberate: prose mentioning
# setIcon() in a comment must not count as having one.
def icons_referenced(source):
    return re.findall(r'setIcon\(basePath \+ "/([^"]+)"\)', source)


def parse_layer_registry():
    """CONSTANT_NAME -> layer-name string, for every CsLayers.X = "..."
    assignment in Core/CsLayers.js. Shared by TestLayerVocabulary (which
    only needs the values) and anything that needs to resolve a
    CsLayers.SOME_CONSTANT reference found elsewhere in the source back
    to its string."""
    with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
        source = fh.read()
    consts = dict(re.findall(r'CsLayers\.([A-Z_]+) = "([^"]+)"', source))
    # The derived twin constants. CsLayers defines these at load time
    # (see the derivation loop at the bottom of that file) rather than
    # spelling out 100 more assignments, so they exist for every caller
    # -- tools/sync_template_layers.js enumerates the registry by walking
    # CsLayers' string properties -- but appear nowhere in the source
    # text for the regex above to find.
    for name in list(consts.values()):
        for twin in frame_twins(name):
            consts[twin.replace("-", "_")] = twin
    return consts


SHEET_LAYERS = {"0", "Defpoints", "BORDER", "TITLE-BLOCK", "LEGEND",
                "SCALE-BAR"}

# The plan-frame layers CsLayers.NO_TWIN excludes from frame twinning.
# A SECOND copy of that set, written from the JS rather than scraped, on
# the same principle as frame_of below: if the two drift, the twin tests
# disagree with the registry and say so.
NO_TWIN = {"CTRL-AERIAL", "CTRL-CONTOUR", "CTRL-CONTOUR-MAJOR",
           "CTRL-GRID", "CTRL-DATA", "CTRL-HIDDEN", "CTRL-RAW",
           "CTRL-CLOSURE",
           "CROSS-SECTION-MARKERS", "NORTH-ARROW"}


def frame_of(name):
    """Which view a layer belongs to: "plan", "profile", "section" or
    "sheet".

    DELIBERATELY A SECOND IMPLEMENTATION of CsLayers.frameOf, written
    from its rules rather than scraped from its source: if either one
    drifts, the tests that compare frames disagree with the JS and say
    so. Same safe default -- an unclassified layer is plan, never
    profile, so a profile-scoped sweep cannot pick up a stray layer.
    """
    if name in SHEET_LAYERS:
        return "sheet"
    if name.startswith("CTRL-PROFILE-") or name.startswith("PROFILE-"):
        return "profile"
    if name.startswith("CTRL-SECTION-") or name.startswith("SECTION-"):
        return "section"
    return "plan"


def frame_twins(name):
    """The PROFILE and SECTION twin names a plan-frame layer derives, or
    () when it derives none.

    The Python side of the derivation loop at the bottom of
    Core/CsLayers.js -- again a second implementation, so a change to the
    twinning rule has to be made in both places deliberately."""
    if name in SHEET_LAYERS or name in NO_TWIN or frame_of(name) != "plan":
        return ()
    if name.startswith("CTRL-"):
        stem = name[len("CTRL-"):]
        return ("CTRL-PROFILE-" + stem, "CTRL-SECTION-" + stem)
    return ("PROFILE-" + name, "SECTION-" + name)


def parse_defaults_table():
    """name -> (colorName, linetype, lineweightKey) for every layer the
    registry styles: the literal rows of CsLayers.DEFAULTS in
    Core/CsLayers.js, PLUS the frame twins that file derives from them at
    load time.

    Source-scraped rather than imported (this is a QCAD-context .js file,
    not something Python can execute) so a test comparing against it
    tracks edits automatically. The derived half has to be recomputed
    here for the same reason -- the twins exist only after the JS has
    run, and no PROFILE- or SECTION- row appears in the source text at
    all.

    The optional 4th element of a row (the linetype fallback for drawings
    with no NSS_* pattern) is deliberately dropped: it names what to use
    when the real linetype is ABSENT, so it is never the appearance a
    template -- which defines every NSS_* pattern -- actually carries."""
    with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
        source = fh.read()
    match = re.search(r"CsLayers\.DEFAULTS = \{(.*?)\n\};", source, re.S)
    assert match is not None, ("CsLayers.DEFAULTS table not found -- did "
                               "its opening/closing syntax change?")
    entries = re.findall(
        r'"([^"]+)":\s*\[\s*"([^"]+)",\s*"([^"]+)",\s*"([^"]+)"'
        r'(?:,\s*"[^"]+")?\s*\]',
        match.group(1))
    table = dict((name, (color, linetype, weight))
                 for name, color, linetype, weight in entries)
    for name in list(table):
        for twin in frame_twins(name):
            table[twin] = table[name]
    return table


# Standard SVG/CSS extended colour keywords, as Qt's QColor(name)
# resolves them and RDxfExporter serialises the result into DXF group
# 420 (AutoCAD true colour, 0xRRGGBB). Fixed by the colour-name spec
# itself, not by anything in this repo -- unlike CsLayers.DEFAULTS,
# which an earlier tools/add_profile_layers.js was duplicating, these
# never drift, so hardcoding them here is not that same problem. Only
# populated for the colour names CsLayers.DEFAULTS uses for the layers
# TestSyncTemplateLayersTool checks the appearance of; extend if a
# DEFAULTS row starts using a new one.
SVG_TRUE_COLOR = {
    "cyan": 0x00FFFF,
    "deepskyblue": 0x00BFFF,
    "gold": 0xFFD700,
    "gray": 0x808080,
    "limegreen": 0x32CD32,
    "magenta": 0xFF00FF,
    "peru": 0xCD853F,
    "pink": 0xFFC0CB,
    "red": 0xFF0000,
    "slateblue": 0x6A5ACD,
    "white": 0xFFFFFF,
}


def strip_layer_records(content, names):
    """Removes the named records from a DXF's LAYER table, byte-for-byte
    identical otherwise. Used to fabricate a pre-migration copy of the
    (already-migrated) shipped template, so the tool's ADD path can be
    exercised without a second binary fixture to keep in sync."""
    start = content.index("  0\nTABLE\n  2\nLAYER\n")
    end = content.index("\n  0\nENDTAB\n", start)
    table = content[start:end]
    header, sep, rest = table.partition("\n  0\nLAYER\n")
    assert sep, "LAYER table has no LAYER records to strip from"
    entries = rest.split("\n  0\nLAYER\n")
    kept = [e for e in entries
            if re.search(r"\n  2\n(.+)\n", e).group(1) not in names]
    new_table = header + "\n  0\nLAYER\n" + "\n  0\nLAYER\n".join(kept)
    return content[:start] + new_table + content[end:]


def parse_layer_records(content):
    """name -> {"truecolor": int, "linetype": str, "lineweight": int}
    for every record in a DXF's LAYER table. Companion to
    strip_layer_records() above -- same delimiter logic, read direction
    instead of write."""
    start = content.index("  0\nTABLE\n  2\nLAYER\n")
    end = content.index("\n  0\nENDTAB\n", start)
    table = content[start:end]
    _, sep, rest = table.partition("\n  0\nLAYER\n")
    assert sep, "LAYER table has no LAYER records to parse"
    out = {}
    for entry in rest.split("\n  0\nLAYER\n"):
        name = re.search(r"\n  2\n(.+)\n", entry).group(1)
        truecolor = re.search(r"\n420\n(\d+)\n", entry)
        linetype = re.search(r"\n  6\n(.+)\n", entry)
        lineweight = re.search(r"\n370\n(-?\d+)\n", entry)
        out[name] = {
            "truecolor": int(truecolor.group(1)) if truecolor else None,
            "linetype": linetype.group(1) if linetype else None,
            "lineweight": (int(lineweight.group(1))
                          if lineweight else None),
        }
    return out


class TestAddonLayout(unittest.TestCase):
    def test_addon_has_its_menu_builder(self):
        # CaveSurvey.js must sit beside the tool folders: it creates the menu
        # and toolbar the tools attach themselves to.
        self.assertTrue(os.path.exists(os.path.join(ADDON, "CaveSurvey.js")))

    def test_every_folder_is_a_tool_or_a_known_library(self):
        # QCAD finds an add-on tool as <Tool>/<Tool>.js. A folder without
        # one is invisible to QCAD -- fine for the known libraries, a
        # silent failure for a mistyped tool folder. So libraries are an
        # explicit allowlist, and anything else must be a proper tool.
        for name in all_dirs():
            if name in LIBRARY_DIRS:
                self.assertFalse(
                    os.path.exists(os.path.join(ADDON, name, name + ".js")),
                    "%s is a library but contains %s.js -- QCAD would "
                    "try to init it as a tool" % (name, name))
            else:
                with self.subTest(tool=name):
                    self.assertTrue(
                        os.path.exists(os.path.join(ADDON, name, name + ".js")),
                        "expected %s/%s.js (or add %s to LIBRARY_DIRS if "
                        "it is a new library)" % (name, name, name))

    def test_no_stray_scripts_beside_the_menu_builder(self):
        loose = [f for f in os.listdir(ADDON)
                 if f.endswith(".js") and f != "CaveSurvey.js"]
        self.assertEqual(loose, [], "these belong in their own folders: %s" % loose)

    # Every live-transaction listener this suite ships (a file whose own
    # header says "installed once from CaveSurvey.js" and that defines an
    # X.install() with no menu action anywhere to call it from). A listener
    # with install() written but never called ships INERT: every one of
    # its own tests still passes -- they call its reconcile/regenerate
    # logic directly -- while no caver ever sees it react to a live edit.
    # AreaFillListener shipped exactly this way for one commit before this
    # test existed; this suite already has a scar from the same class of
    # bug elsewhere (a tool absent from the menu, a save hook that never
    # fired), which is why this is a standing structural check and not a
    # one-off fix.
    LISTENERS = {
        "Callout/CalloutListener.js": "CalloutListener",
        "ShapedLines/ShapedLinesListener.js": "ShapedLinesListener",
        "AreaFill/AreaFillListener.js": "AreaFillListener",
    }

    def test_every_listener_is_included_and_installed(self):
        source = tool_source_at("CaveSurvey.js")
        included = live_includes(source)
        installed = live_install_calls(source)
        for relpath, obj in self.LISTENERS.items():
            with self.subTest(listener=obj):
                self.assertTrue(
                    os.path.exists(os.path.join(ADDON, relpath)),
                    "%s does not exist -- update TestAddonLayout.LISTENERS "
                    "if it moved or was retired" % relpath)
                self.assertIn(
                    os.path.basename(relpath), included,
                    "CaveSurvey.js does not include %s -- %s would be "
                    "undefined at runtime" % (relpath, obj))
                self.assertIn(
                    obj, installed,
                    "CaveSurvey.js never calls %s.install() -- %s ships "
                    "inert: every one of its own tests still passes "
                    "(they call its logic directly), but no caver ever "
                    "sees it react to a live edit" % (obj, obj))

    # Tools whose action is registered but deliberately NOT on the menu:
    # their panel is reached through another tool's door. Listed with
    # the reason, so taking a tool off the menu stays a decision.
    OFF_MENU = {
        "FeatureTrace": "its panel is a section of Draw",
        "SymbolPalette": "its panel is a section of Draw",
        "AreaFill": "its panel is a section of Draw",
    }

    def test_tools_are_registered_on_the_menu_and_toolbar(self):
        for name in tool_dirs():
            if name in self.OFF_MENU:
                continue
            with self.subTest(tool=name):
                source = tool_source(name)
                for widget in WIDGET_NAMES:
                    self.assertIn(widget, source)

    def test_off_menu_tools_say_so(self):
        """A tool off the menu has to be off it on purpose.

        setWidgetNames([]) is one character away from a typo that takes
        a tool out of the menu silently -- which is the failure this
        whole file exists for.
        """
        for name, why in self.OFF_MENU.items():
            with self.subTest(tool=name):
                source = tool_source(name)
                self.assertIn(
                    "action.setWidgetNames([]);", source,
                    "%s is listed as off the menu (%s) but does not "
                    "clear its widget names" % (name, why))
                self.assertIn(
                    "NOT ON THE MENU", source,
                    "%s should say in its own source why it is off the "
                    "menu" % name)

    def test_each_tool_points_setscriptfile_at_its_own_file(self):
        for name in tool_dirs():
            with self.subTest(tool=name):
                self.assertIn('setScriptFile(basePath + "/%s.js")' % name,
                              tool_source(name))

    def test_each_tool_has_a_command_line_name(self):
        for name in tool_dirs():
            with self.subTest(tool=name):
                self.assertIn("setDefaultCommands(", tool_source(name))

    def test_referenced_icons_exist(self):
        # A setIcon() pointing at a missing file renders as a blank button.
        # Note this deliberately validates only what a tool references: a
        # tool mid-development with no icon at all is fine day to day, and
        # TestPublishReadiness is what insists on one before shipping.
        for name in tool_dirs():
            source = tool_source(name)
            for icon in icons_referenced(source):
                with self.subTest(tool=name, icon=icon):
                    self.assertTrue(
                        os.path.exists(os.path.join(ADDON, name, icon)),
                        "%s references missing icon %s" % (name, icon))

    def test_sort_orders_are_unique(self):
        # Two tools sharing a sort order within the same group leaves their menu
        # order down to load sequence.
        orders = {}
        for name in tool_dirs():
            source = tool_source(name)
            key = (find_int(source, "action.setGroupSortOrder"),
                   find_int(source, "action.setSortOrder"))
            orders.setdefault(key, []).append(name)
        clashes = {key: names for key, names in orders.items() if len(names) > 1}
        self.assertEqual(clashes, {}, "colliding (group, sort) orders: %s" % clashes)

    def test_every_tool_declares_a_sort_order(self):
        for name in tool_dirs():
            with self.subTest(tool=name):
                self.assertIsNotNone(
                    find_int(tool_source(name), "action.setSortOrder"))


@unittest.skipUnless(PUBLISH_CHECK,
                     "publish check -- run with CAVESURVEY_PUBLISH_CHECK=1, "
                     "or ./tests/run_all.sh --publish")
class TestPublishReadiness(unittest.TestCase):
    """
    Requirements for shipping the add-on to other people, not for working on it.

    A missing icon doesn't stop a tool working, so it shouldn't fail the day-to-
    day suite -- but a released toolbar with blank buttons on it is not
    something to hand a surveyor.
    """

    def test_every_tool_has_an_icon(self):
        # Matched against the real call, not a bare "setIcon(" substring:
        # AerialBasemap once carried the comment "No setIcon() yet -- the
        # icon is Task 4's job", whose text satisfied a substring check and
        # left this gate green for a tool that had no icon at all.
        missing = [name for name in tool_dirs()
                   if not icons_referenced(tool_source(name))]
        self.assertEqual(missing, [], "no toolbar icon: %s" % missing)

    def test_every_icon_is_parseable_svg(self):
        # A file QCAD can't parse renders exactly like a missing one.
        for name in tool_dirs():
            icons = icons_referenced(tool_source(name))
            # Assert before the loop: a tool referencing no icon would
            # otherwise iterate zero times and pass vacuously.
            self.assertTrue(icons, "%s references no icon" % name)
            for icon in icons:
                path = os.path.join(ADDON, name, icon)
                with self.subTest(tool=name, icon=icon):
                    self.assertTrue(os.path.exists(path))
                    root = ElementTree.parse(path).getroot()
                    self.assertTrue(root.tag.endswith("svg"),
                                    "%s is not an <svg> document" % icon)

    def test_every_tool_has_a_status_tip(self):
        # This is the one-line explanation shown when hovering the menu entry --
        # for a layman it's often the only documentation they'll read.
        for name in tool_dirs():
            with self.subTest(tool=name):
                self.assertIn("setStatusTip(", tool_source(name))


class TestTemplates(unittest.TestCase):
    def test_the_plan_template_is_present(self):
        self.assertTrue(os.path.exists(
            os.path.join(TEMPLATES, "NSS_Cave_Template_PLAN.dxf")))

    def test_no_standalone_profile_template_ships(self):
        """One template, not two. NSS_Cave_Template_PROFILE.dxf is
        deleted: no code path ever opened it (CaveTemplateApply loads the
        PLAN template only) and the elevation is drawn INTO the plan
        drawing now, so a standalone elevation sheet would be a second
        answer to "which file do I start from". Its absence is pinned
        rather than merely done, because putting it back also puts back a
        layer set whose view layers carry plan-frame names -- the
        cross-frame collision the frame split exists to remove.
        """
        self.assertFalse(os.path.exists(
            os.path.join(TEMPLATES, "NSS_Cave_Template_PROFILE.dxf")))


class TestIncludes(unittest.TestCase):
    def test_every_include_target_exists(self):
        # include() failing at QCAD startup surfaces as the whole add-on
        # silently missing from the menu -- which is exactly how 2.0.0
        # shipped: include("scripts/CaveSurvey/...") only resolves
        # against QCAD's OWN scripts folder, never the per-user add-on
        # folder, and it fails silently. So suite-internal includes must
        # be includeBasePath-relative, and this test both bans the
        # broken form and checks the relative targets exist.
        for dirpath, _dirnames, filenames in os.walk(ADDON):
            for filename in filenames:
                if not filename.endswith(".js"):
                    continue
                path = os.path.join(dirpath, filename)
                with open(path) as fh:
                    source = fh.read()

                self.assertNotRegex(
                    source, r'include\("scripts/CaveSurvey/',
                    "%s uses include(\"scripts/CaveSurvey/...\"), which "
                    "silently fails from the per-user install -- use "
                    "include(includeBasePath + \"/...\") instead" % filename)

                for target in re.findall(
                        r'include\(includeBasePath \+ "/([^"]+)"\)', source):
                    resolved = os.path.normpath(os.path.join(dirpath, target))
                    with self.subTest(script=filename, include=target):
                        self.assertTrue(
                            os.path.exists(resolved),
                            "%s includes missing %s" % (filename, target))


class TestTemplateLayerGroups(unittest.TestCase):
    """The shipped template's layer groups must be what CsLayerGroups says.

    The template ships with its layers already filed, so a new cave map
    opens with the Layer Manager arranged and nothing to run. That only
    holds if the stored arrangement and the classifier agree: a layer
    added to the registry, or a rule changed in CsLayerGroups, otherwise
    leaves the template saying something nobody can reproduce.

    Asserted by running the sync tool over the shipped bytes and
    demanding the pure skip path, the same bargain
    TestSyncTemplateLayers strikes -- which means the real classifier
    does the comparing and there is no second copy of the rules here to
    drift.
    """

    CAVECAD = "/Applications/CaveCAD.app/Contents/MacOS/CaveCAD"

    def setUp(self):
        if not os.path.exists(self.CAVECAD):
            self.skipTest("CaveCAD not found at %s -- see run_all.sh" %
                          self.CAVECAD)

    def test_the_shipped_template_is_already_grouped(self):
        if PUBLISH_CHECK:
            # A publish check points TEMPLATES at the staged copy, whose
            # tree is the INSTALLED layout (CaveSurvey/Core/..., no
            # scripts/ above it) and so is not a repoRoot this tool can
            # read. The staged template is a byte copy of the repo's, and
            # the repo's is what this test is about, so checking it twice
            # would only be checking cp.
            self.skipTest("the staged copy is not a repoRoot; the repo's "
                          "own template is checked on every other run")
        result = subprocess.run(
            [self.CAVECAD, "-no-dock-icon", "-no-gui",
             "-allow-multiple-instances", "-autostart",
             os.path.join(REPO, "tools", "sync_template_groups.js"), REPO],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
        output = result.stdout.decode("utf-8", "replace")
        plan = os.path.join(REPO, "templates", "NSS_Cave_Template_PLAN.dxf")
        self.assertIn(
            "skip  %s -- groups already match CsLayerGroups" % plan,
            output.splitlines(),
            "the shipped template's layer groups are out of step with "
            "CsLayerGroups -- re-run tools/sync_template_groups.js. "
            "Got: %r" % output)
        self.assertIn("### SYNC TEMPLATE GROUPS OK", output.splitlines())


class TestFunctionPropertyShadowing(unittest.TestCase):
    """A static named apply(), call(), bind() or name is a silent no-op.

    A class declared `function MyTool() {}` IS a Function object, and
    Function already carries apply, call, bind and name. Assigning over
    one of those does not take: the property stays Function's, so
    `MyTool.apply(doc)` reaches Function.prototype.apply, calls the class
    with `doc` as `this`, and returns undefined. Nothing throws, nothing
    is logged, and the caller just sees an empty result.

    Cost two separate live debugging sessions in one day -- once as
    LayerStates.apply in the fork's Layer Manager, once as
    CsLayerGroups' filing pass here -- which is why it is a test and
    not a note.

    A plain object (`var CsRestyle = {};`) has no such properties and is
    not flagged: CsRestyle.apply, CsScanFit.apply and CsRevise.apply are
    all fine, and renaming them would be churn for nothing. The
    declaration form is what decides, so this test reads it per file
    rather than matching on the member name alone.
    """

    RESERVED = ["apply", "call", "bind", "name", "caller", "arguments"]

    def test_no_static_shadows_a_function_property(self):
        declared = re.compile(r"^function\s+([A-Za-z_$][\w$]*)\s*\(", re.M)
        assigned = re.compile(
            r"^\s*([A-Z][A-Za-z0-9_]*)\.(" + "|".join(self.RESERVED) + r")\s*=",
            re.M)
        offenders = []
        for folder, _subdirs, files in os.walk(ADDON):
            for name in files:
                if not name.endswith(".js"):
                    continue
                path = os.path.join(folder, name)
                with open(path) as handle:
                    source = handle.read()
                functions = set(declared.findall(source))
                for match in assigned.finditer(source):
                    if match.group(1) in functions:
                        offenders.append("%s: %s.%s" % (
                            os.path.relpath(path, ADDON),
                            match.group(1), match.group(2)))
        self.assertEqual(
            [], offenders,
            "these assignments silently do not take, because the class is "
            "a Function and Function already owns the property: %s -- "
            "rename the member (applyCode, fileAll, ...)" % offenders)


class TestNoNativeFileDialogs(unittest.TestCase):
    """QFileDialog's statics (getOpenFileName, getSaveFileName,
    getExistingDirectory, ...) silently open the PLATFORM's picker
    whatever CaveCAD's preference says, and Nathan's standing rule is Qt's
    own dialogs everywhere. Every picker goes through Core/CsFiles.js,
    which builds the dialog and passes getDontUseNativeDialog(). Found on
    Windows, 2026-09-26: eleven call sites had drifted to the statics."""

    STATIC = re.compile(r"QFileDialog\.get(OpenFileName|OpenFileNames|"
                        r"SaveFileName|ExistingDirectory|OpenFileUrl)\s*\(")

    def test_no_file_dialog_statics(self):
        offenders = []
        for folder, _subdirs, files in os.walk(ADDON):
            for name in files:
                if not name.endswith(".js") or name == "CsFiles.js":
                    continue
                path = os.path.join(folder, name)
                with open(path) as handle:
                    for number, line in enumerate(handle, 1):
                        if self.STATIC.search(line):
                            offenders.append("%s:%d" % (
                                os.path.relpath(path, ADDON), number))
        self.assertEqual(
            [], offenders,
            "these open the platform's file dialog: %s -- use "
            "CsFiles.openFile / saveFile / directory" % offenders)


class TestBasenameCollisions(unittest.TestCase):
    """QCAD's include() dedupes by BASENAME: a library file sharing a
    name with anything QCAD already included (Draw.js, File.js, ...)
    is skipped silently. Cs-prefixed basenames make that impossible,
    so every Core file must carry the prefix."""

    def test_every_core_file_is_included_by_csall(self):
        # A Core file missing from CsAll.js is undefined at runtime in
        # EVERY tool, and nothing else in this suite notices: js_unit.js
        # loads Core files individually with loadRepoScript, so it passes
        # either way. This is the only place that gap is visible.
        core = os.path.join(ADDON, "Core")
        with open(os.path.join(core, "CsAll.js")) as handle:
            source = handle.read()
        # Parse the LIVE include lines, not the file text. A first cut of
        # this test grepped the whole file for the filename, which a
        # commented-out include still satisfies -- so it passed with the
        # include disabled, exactly the vacuous-substring failure the
        # icon test's comment warns about.
        listed = set()
        for line in source.splitlines():
            stripped = line.strip()
            if stripped.startswith("//"):
                continue
            found = re.search(r'include\(includeBasePath \+ "([^"]+)"\)',
                              stripped)
            if found:
                listed.add(os.path.basename(found.group(1)))
        missing = []
        for dirpath, _dirnames, filenames in os.walk(core):
            for filename in sorted(filenames):
                if not filename.startswith("Cs") or \
                        not filename.endswith(".js"):
                    continue
                if filename == "CsAll.js":
                    continue
                if filename not in listed:
                    missing.append(os.path.relpath(
                        os.path.join(dirpath, filename), core))
        self.assertEqual(sorted(missing), [],
                         "these Core files are not included by CsAll.js: "
                         "%s" % sorted(missing))

    def test_no_addon_file_shares_a_basename_with_qcad(self):
        """The whole suite, not just Core. A TOOL file goes through the
        same include(), so Draw/Draw.js was skipped in favour of QCAD's
        own scripts/Draw/Draw.js -- published clean, passed every test,
        and the panel did not exist in the running application. Only
        the live engine showed it, which is exactly the gap this
        closes. Skipped where CaveCAD is not installed."""
        stock_root = ("/Applications/CaveCAD.app/Contents/Resources/"
                      "scripts")
        if not os.path.isdir(stock_root):
            self.skipTest("CaveCAD is not installed here")
        stock = set()
        for dirpath, _dirnames, filenames in os.walk(stock_root):
            for filename in filenames:
                if filename.endswith(".js"):
                    stock.add(filename)
        clashes = []
        for dirpath, _dirnames, filenames in os.walk(ADDON):
            for filename in sorted(filenames):
                if not filename.endswith(".js"):
                    continue
                if filename in stock:
                    clashes.append(os.path.relpath(
                        os.path.join(dirpath, filename), ADDON))
        self.assertEqual(sorted(clashes), [],
                         "include() dedupes by basename, so QCAD's copy "
                         "wins and these files never load: %s"
                         % sorted(clashes))

    def test_core_files_are_cs_prefixed(self):
        core = os.path.join(ADDON, "Core")
        for dirpath, _dirnames, filenames in os.walk(core):
            for filename in filenames:
                if filename.endswith(".js"):
                    with self.subTest(script=filename):
                        self.assertTrue(
                            filename.startswith("Cs"),
                            "%s: Core basenames must start with Cs -- "
                            "include() dedupes by basename and stock "
                            "QCAD's own scripts win" % filename)


class TestSiblingToolsAreWired(unittest.TestCase):
    """QCAD's AddOn.getAddOns (see AddOn.js, around line 545) only ever
    loads <Dir>/<Dir>.js on its own -- it never looks at any other file
    in a tool's folder. A folder can still hold more than one RGuiAction
    (ShapedLines' per-style draw buttons are the live example): the ONLY
    reason those work is that <Dir>.js explicitly includes each sibling
    and calls its init(basePath) itself, the pattern documented in
    ShapedLines.js's own header comment ("sibling files QCAD cannot
    discover on its own").

    SketchSection (now folded into CrossSection/ as SectionBay.js)
    shipped without doing this for SectionCapture.js and SectionEdit.js:
    both files existed, both passed every file-existence and file-shape
    check in this suite, and neither was reachable from the running
    application -- no menu entry, no toolbar button, no "skc"/"ske"
    command. tests/section_sketch_run.js still passed because it loads
    all three files by hand with loadRepoScript, bypassing exactly the
    discovery path this test checks. Neither file registers its own
    init() any more -- Capture and Reopen are routes in CrossSection's
    own dialog and buttons on SectionBayPanel now, not menu entries --
    so this test has nothing left to check in that folder; it stays for
    the next tool that tries the ShapedLines pattern.

    Note this is deliberately narrower than "every sibling file must be
    included": a sibling with no init() of its own is a plain library
    (CalloutWrite.js, ScanView.js, CaveTemplateApply.js, ...) that its
    folder's tool merely calls into on its own terms, sometimes not even
    via include()+init() at all (CaveTemplateApply.js is registered
    through NewFile.addPostNewAction instead). Only a sibling that
    registers its OWN RGuiAction via its own init() has a menu entry to
    lose.
    """

    def test_every_sibling_tool_is_included_and_initialised(self):
        for name in tool_dirs():
            siblings = sibling_tool_files(name)
            if not siblings:
                continue
            main_source = tool_source(name)
            included = live_includes(main_source)
            called = live_init_calls(main_source)
            for filename, obj in siblings:
                with self.subTest(tool=name, sibling=filename):
                    self.assertIn(
                        filename, included,
                        "%s/%s.js does not include sibling %s -- %s.%s "
                        "would be undefined at runtime" %
                        (name, name, filename, obj, "init"))
                    self.assertIn(
                        obj, called,
                        "%s/%s.js never calls %s.init(basePath) -- %s "
                        "has no menu entry, toolbar button or command "
                        "in the running application" %
                        (name, name, obj, filename))


class TestSimpleJsGlobals(unittest.TestCase):
    """A file that calls getDocument() must include the file defining it.

    getDocument() and getDocumentInterface() live in QCAD's
    scripts/simple.js and nowhere else. A tool that calls one without
    including it does NOT fail honestly: it works whenever some other
    tool has already pulled simple.js into the script context this
    session, and dies with "ReferenceError: getDocument is not defined"
    when it is the first thing run after a launch. What a caver sees is
    a menu entry that is present, enabled, and does nothing -- once,
    unreproducibly, and never again that session.

    Neither the engine harness nor a unit test can catch it: every
    engine suite defines both functions by hand to point at its fixture
    document, which is exactly what hides the missing include.

    Core/ is exempt: those files are libraries, included by whoever uses
    them, and CsAll.js is never an action's entry point.
    """

    # EAction.getDocument() is a different function on a class that is
    # always in scope, and needs no include.
    CALL = re.compile(r"(?<![.\w])getDocument(?:Interface)?\s*\(")

    def tool_sources(self):
        for folder, _subdirs, files in os.walk(ADDON):
            if os.path.basename(folder) == "Core":
                continue
            for name in files:
                if name.endswith(".js"):
                    path = os.path.join(folder, name)
                    with open(path, encoding="utf-8",
                              errors="replace") as fh:
                        yield os.path.relpath(path, ADDON), fh.read()

    def test_callers_of_getdocument_include_simple_js(self):
        missing = []
        for rel, source in self.tool_sources():
            if not self.CALL.search(source):
                continue
            if 'include("scripts/simple.js")' in source:
                continue
            missing.append(rel)
        self.assertEqual(
            sorted(missing), [],
            "these files call getDocument()/getDocumentInterface() but "
            "never include scripts/simple.js, where those are defined: "
            "%s -- each is a tool that does nothing when it is the first "
            "one run after a launch" % sorted(missing))


class TestLayerVocabulary(unittest.TestCase):
    """The layer names in Core/CsLayers.js and the plan template must agree.

    The old importer invented layer names no template carried; this pins
    the registry to the template so the two cannot drift apart again.
    """

    def layer_registry(self):
        return set(parse_layer_registry().values())

    def template_layers(self, name):
        with open(os.path.join(TEMPLATES, name), encoding="utf-8",
                  errors="replace") as fh:
            content = fh.read()
        match = re.search(r"2\nLAYER\n(.*?)\n  0\nENDTAB", content, re.S)
        return set(re.findall(r"^  2\n(.+)$", match.group(1), re.M))

    def test_registry_defines_section_layers(self):
        """Same mutation gap as the profile control layers: the registry
        comparison never asserts a constant EXISTS, so deleting one
        shrinks both sides of it and passes. These are the layers the
        section tool draws on and the caver traces in; a missing one
        means a section lands somewhere nobody looks.
        """
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        # The APPEARANCE half is no longer a literal row in the source:
        # every SECTION- layer below derives its style from its plan twin
        # (see the derivation loop at the bottom of CsLayers.js), so what
        # has to be asserted is that the resolved table has an entry --
        # grepping the source for '"SECTION-CEILING": [' would now fail
        # on a registry that is perfectly correct.
        defaults = parse_defaults_table()
        for constant, layer in [
                ("CTRL_SECTION_BOX", "CTRL-SECTION-BOX"),
                ("CTRL_SECTION_OUTLINE", "CTRL-SECTION-OUTLINE"),
                ("CTRL_SECTION_SPLAYS", "CTRL-SECTION-SPLAYS"),
                ("CTRL_SECTION_STATIONS", "CTRL-SECTION-STATIONS"),
                ("CTRL_SECTION_TEXT_LABELS", "CTRL-SECTION-TEXT-LABELS"),
                ("CTRL_SECTION_SCAN", "CTRL-SECTION-SCAN"),
                ("SECTION_WALLS_SURVEYED", "SECTION-WALLS-SURVEYED"),
                ("SECTION_WALLS_INFERRED", "SECTION-WALLS-INFERRED"),
                ("SECTION_CEILING", "SECTION-CEILING"),
                ("SECTION_FLOOR", "SECTION-FLOOR"),
                ("SECTION_BREAKDOWN", "SECTION-BREAKDOWN")]:
            self.assertIn('CsLayers.%s = "%s";' % (constant, layer), source)
            self.assertIn(layer, defaults,
                          "%s has no resolved appearance -- neither a "
                          "literal DEFAULTS row nor a derivable plan twin"
                          % layer)

    def test_layer_constant_matches_its_layer_name(self):
        """THE ONE NAMING RULE: a layer constant IS its layer name with
        dashes turned into underscores. CsLayers.CTRL_PROFILE_FLOOR is
        "CTRL-PROFILE-FLOOR"; CsLayers.PROFILE_FLOOR is "PROFILE-FLOOR".

        This exists because three conventions had grown side by side --
        30 generated layers whose constant did not say they were
        generated, 18 that did, and 2 traced ones marked _TRACED_ that
        70 others were not. Worse, the SAME constant shape meant
        different KINDS in different frames: PROFILE_FLOOR was the
        generated CTRL-PROFILE-FLOOR while SECTION_FLOOR was the traced
        SECTION-FLOOR, so a reader assuming symmetry got the wrong
        layer. FeatureTrace's own ROWS test still carries a comment
        about that slip costing an hour of tracing.

        A rule a machine can check is the only kind that survives.
        """
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        pairs = re.findall(r'^CsLayers\.([A-Z_0-9]+) = "([^"]+)";',
                           source, re.M)
        self.assertGreater(len(pairs), 100, "the registry should be here")
        wrong = [(c, n) for c, n in pairs if c != n.replace("-", "_")]
        self.assertEqual(wrong, [],
                         "layer constants that do not match their own "
                         "layer name: %s" % wrong)

    def test_registry_layers_exist_in_plan_template(self):
        """EVERY registry layer, with no exemptions. The wall run layers
        used to be exempted here as "created on demand", and they were
        indeed created on demand -- which meant a fresh drawing's Layer
        list did not offer them until the first draw put walls on them,
        and nothing checked what they looked like when it did.
        tools/sync_template_layers.js puts every registry layer in the
        template instead, so the exemption set is gone on purpose: adding
        one back is how a layer goes missing from the template again.
        """
        registry = self.layer_registry()
        plan = self.template_layers("NSS_Cave_Template_PLAN.dxf")
        missing = registry - plan
        self.assertEqual(missing, set(),
                         "layers in Core/CsLayers.js but not the plan "
                         "template: %s" % sorted(missing))

    def test_plan_template_has_every_profile_frame_layer(self):
        """The elevation draws into the plan drawing, so every layer it
        needs must be in the plan template -- not invented at runtime
        with whatever defaults happen to apply. Subsumed by the test
        above now that nothing is exempt from it, and kept anyway: this
        one fails with the word "profile" in the message, which is the
        difference between a one-line diagnosis and a hunt.
        """
        registry = self.layer_registry()
        plan = self.template_layers("NSS_Cave_Template_PLAN.dxf")
        profile_frame = set(n for n in registry
                            if frame_of(n) == "profile")
        self.assertTrue(profile_frame, "no profile-frame layers in the registry")
        missing = profile_frame - plan
        self.assertEqual(missing, set(),
                         "profile-frame layers absent from the PLAN "
                         "template: %s" % sorted(missing))

    def test_registry_defines_profile_control_layers(self):
        """Mutation-tested gap: deleting CsLayers.CTRL_PROFILE_FLOOR and
        CsLayers.CTRL_PROFILE_CEILING left the whole suite green, because
        test_registry_layers_exist_in_plan_template only ever compares
        the registry against the template -- it never asserts a
        particular constant exists at all, so deleting one shrinks both
        sides of the comparison. This pins both the constant and its
        CsLayers.DEFAULTS entry, which also protects
        tools/sync_template_layers.js: that tool reads DEFAULTS through
        CsLayers.ensure() instead of carrying its own copy of a layer's
        appearance, so a deleted or wrong DEFAULTS entry breaks both this
        test and the tool the same way.
        """
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        self.assertIn('CsLayers.CTRL_PROFILE_FLOOR = "CTRL-PROFILE-FLOOR";',
                     source)
        self.assertIn('CsLayers.CTRL_PROFILE_CEILING = "CTRL-PROFILE-CEILING";',
                     source)
        defaults = parse_defaults_table()
        self.assertEqual(defaults.get("CTRL-PROFILE-FLOOR"),
                         ("gray", "DASHED", "Weight000"))
        self.assertEqual(defaults.get("CTRL-PROFILE-CEILING"),
                         ("gray", "DASHED", "Weight000"))

    WALL_RUN_LAYERS = ("CTRL-LRUD-WALL-LEFT", "CTRL-LRUD-WALL-RIGHT")

    def test_registry_defines_the_lrud_wall_layers_as_dashed(self):
        """A wall run is an APPROXIMATION -- straight segments between
        the LRUD ticks and splay tips either side of the centerline, cut
        at junctions and at stations with no wall evidence. It has to
        plot dashed, so a reader can never mistake it for the solid line
        a wall traced onto WALLS-SURVEYED gets. Same shape as the test
        above: the constant AND its appearance, because the comparison
        against the template cannot see a constant that is gone.
        """
        with open(os.path.join(ADDON, "Core", "CsLayers.js")) as fh:
            source = fh.read()
        self.assertIn('CsLayers.CTRL_LRUD_WALL_LEFT = "CTRL-LRUD-WALL-LEFT";',
                      source)
        self.assertIn('CsLayers.CTRL_LRUD_WALL_RIGHT = "CTRL-LRUD-WALL-RIGHT";',
                      source)
        defaults = parse_defaults_table()
        for name in self.WALL_RUN_LAYERS:
            with self.subTest(layer=name):
                self.assertEqual(defaults.get(name),
                                 ("gray", "DASHED", "Weight000"),
                                 "%s must be dashed in CsLayers.DEFAULTS "
                                 "-- an approximated wall may not plot "
                                 "like a traced one" % name)

    def test_plan_template_draws_the_lrud_walls_dashed(self):
        """And dashed in the SHIPPED template, which is what a new
        drawing actually gets: CsLayers.ensure() only reaches DEFAULTS
        for a layer the drawing lacks, so the template's own record is
        the one that decides how these plot in practice.
        """
        with open(os.path.join(TEMPLATES, "NSS_Cave_Template_PLAN.dxf"),
                  encoding="utf-8", errors="replace") as fh:
            records = parse_layer_records(fh.read())
        for name in self.WALL_RUN_LAYERS:
            with self.subTest(layer=name):
                self.assertIn(name, records)
                self.assertNotEqual(
                    (records[name]["linetype"] or "").upper(), "CONTINUOUS",
                    "%s plots solid in the plan template" % name)
                self.assertEqual(
                    (records[name]["linetype"] or "").upper(), "DASHED",
                    "%s: linetype %r in the plan template, expected DASHED"
                    % (name, records[name]["linetype"]))


class TestSyncTemplateLayersTool(unittest.TestCase):
    """tools/sync_template_layers.js must add every registry layer the
    PLAN template lacks, give each the appearance CsLayers.DEFAULTS
    names, and do nothing at all on every run after.

    It replaces tools/add_profile_frame_layers.js, which is deleted,
    which replaced tools/add_profile_layers.js, also deleted. Each of
    those carried a HAND-WRITTEN list of the layers it was responsible
    for, so every layer added to the registry afterwards needed a new
    one-shot tool with a new list -- and the two LRUD wall run layers
    were never in any of them. This tool reads the registry itself.

    The fixture is fabricated FROM the shipped template (records
    stripped) rather than kept as a separate binary file, so it cannot
    drift from the real template the way a second checked-in fixture
    could.

    Shells out to the real CaveCAD engine (~1s per invocation) because
    "run the one-shot tool and inspect what it wrote" cannot be checked
    any other way; every test here skips itself when CaveCAD is not
    installed at the expected path.
    """

    CAVECAD = os.environ.get(
        "CAVESURVEY_CAVECAD",
        "/Applications/CaveCAD.app/Contents/MacOS/CaveCAD")

    # The exact layers the fixture strips and the tool must put back:
    # the whole profile frame, plus the two wall run layers the plan
    # template went without for as long as they were "created on
    # demand". Fixed here independent of the registry, so an edit that
    # drops one from the registry fails this test instead of shrinking
    # its own expectation to match.
    STRIPPED = ("CTRL-PROFILE-SHOTS", "CTRL-PROFILE-STATIONS",
                "CTRL-PROFILE-STATION-LABELS", "CTRL-PROFILE-SPLAYS",
                "CTRL-PROFILE-LRUD", "CTRL-PROFILE-FLOOR",
                "CTRL-PROFILE-CEILING", "PROFILE-CEILING",
                "PROFILE-FLOOR", "PROFILE-WALLS-INFERRED",
                "PROFILE-TEXT-NOTES", "PROFILE-TEXT-LABELS",
                "PROFILE-BREAKDOWN", "PROFILE-ENTRANCE",
                "CTRL-LRUD-WALL-LEFT", "CTRL-LRUD-WALL-RIGHT",
                # The callout style layers, so the sync tool is shown
                # to apply their DEFAULTS colour/linetype/weight when it
                # CREATES them.
                #
                # Be precise about what this does NOT prove. This test
                # strips the layers, re-syncs, and compares the result
                # against DEFAULTS -- so DEFAULTS is both the input and
                # the expectation, and changing a DEFAULTS row moves
                # both sides together. Verified by mutation: inverting
                # NOTES-ELEVATION/NOTES-ELEVATION-LINE leaves this suite
                # green. Nothing here checks that the ALREADY-SHIPPED
                # template agrees with DEFAULTS, and CsLayers.ensure
                # resolves appearance at CREATION only, so a re-sync
                # over existing layers does not recolour them. That is a
                # real, pre-existing gap -- it let
                # ELEVATION/ELEVATION-LINE ship inverted -- and closing
                # it is not a one-liner: 42 of the template's 44
                # registry layers carry an ACI index (group 62) and no
                # truecolour (group 420) at all, so such a test first
                # needs a decision about which representation is
                # canonical.
                #
                # NOTES-HAZARD and NOTES-DIG are NOT stripped any more:
                # shipped symbol blocks (SYM_DANGER, SYM_DIG,
                # SYM_CONTINUATION) draw on them, so a stripped record is
                # re-created by the DXF reader the moment an entity names
                # the layer -- with the default white style, which the
                # sync then reports as a restyle rather than an add.
                "NOTES-EQUIPMENT",
                "NOTES-NAME", "NOTES-ELEVATION",
                "NOTES-ELEVATION-LINE")

    def setUp(self):
        if not os.path.exists(self.CAVECAD):
            self.skipTest("CaveCAD not found at %s -- see run_all.sh" %
                          self.CAVECAD)

    def run_tool(self, fake_repo_root):
        # -no-dock-icon/-no-gui/-allow-multiple-instances match the
        # invocation documented in the tool's own header and run_all.sh.
        result = subprocess.run(
            [self.CAVECAD, "-no-dock-icon", "-no-gui",
             "-allow-multiple-instances", "-autostart",
             os.path.join(REPO, "tools", "sync_template_layers.js"),
             fake_repo_root],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        return result.stdout.decode("utf-8", "replace")

    def make_fake_repo(self, tmp, plan_bytes=None):
        """A throwaway repoRoot: the tool derives the Core library
        location AND the template path from this single argument, so it
        needs a real scripts/CaveSurvey/Core (symlinked -- CsLayers.js
        must be the genuine, current one) and a templates/ directory.
        Passing None for plan_bytes leaves the template absent, to
        exercise the importFile-failure branch. Returns the template
        path, which may or may not exist on disk."""
        os.symlink(os.path.join(REPO, "scripts"), os.path.join(tmp, "scripts"))
        os.mkdir(os.path.join(tmp, "templates"))
        path = os.path.join(tmp, "templates", "NSS_Cave_Template_PLAN.dxf")
        if plan_bytes is not None:
            with open(path, "wb") as fh:
                fh.write(plan_bytes)
        return path

    def shipped(self, name):
        with open(os.path.join(TEMPLATES, name), "rb") as fh:
            return fh.read().decode("utf-8", "replace")

    def pre_migration_plan(self):
        """The shipped PLAN template with STRIPPED taken back out of its
        LAYER table, and nothing else touched."""
        return strip_layer_records(
            self.shipped("NSS_Cave_Template_PLAN.dxf"),
            self.STRIPPED).encode("utf-8")

    def expected_ok_lines(self, plan):
        """The two lines the ADD path prints: the summary, then the list.

        The tool restyles as well as adds now, so the summary carries a
        restyle count too -- and over a fixture whose only fault is
        MISSING layers that count is zero, which is itself worth
        asserting: a restyle sweep that "fixed" layers already correct
        would rewrite the shipped template on every run."""
        return ["ok    %s -- %d layer(s) added, 0 of %d restyled"
                % (plan, len(self.STRIPPED), len(parse_defaults_table()) - 1),
                "      added:    " + ", ".join(sorted(self.STRIPPED))]

    def test_add_path_then_idempotence(self):
        defaults = parse_defaults_table()

        with tempfile.TemporaryDirectory() as tmp:
            plan = self.make_fake_repo(tmp, self.pre_migration_plan())

            first = self.run_tool(tmp)
            lines = first.splitlines()
            for expected in self.expected_ok_lines(plan):
                self.assertIn(
                    expected, lines,
                    "the add path did not report the exact expected line "
                    "-- got: %r" % first)
            self.assertIn("### SYNC TEMPLATE LAYERS OK", lines)

            with open(plan, "rb") as fh:
                plan_after = fh.read()

            # every added layer carries its CsLayers.DEFAULTS appearance
            records = parse_layer_records(
                plan_after.decode("utf-8", "replace"))
            for name in self.STRIPPED:
                self.assertIn(
                    name, records,
                    "%s missing from the PLAN template's LAYER table "
                    "after the tool reported adding it" % name)
                color_name, linetype, weight_key = defaults[name]
                expected_truecolor = SVG_TRUE_COLOR[color_name]
                expected_weight = int(weight_key.replace("Weight", ""))
                actual = records[name]
                self.assertEqual(
                    actual["truecolor"], expected_truecolor,
                    "%s: colour 0x%06X does not match CsLayers.DEFAULTS "
                    "%r (0x%06X)" % (name, actual["truecolor"] or 0,
                                     color_name, expected_truecolor))
                self.assertEqual(
                    (actual["linetype"] or "").upper(), linetype.upper(),
                    "%s: linetype %r does not match CsLayers.DEFAULTS %r"
                    % (name, actual["linetype"], linetype))
                self.assertEqual(
                    actual["lineweight"], expected_weight,
                    "%s: lineweight %r does not match CsLayers.DEFAULTS "
                    "%r (%d)" % (name, actual["lineweight"], weight_key,
                                 expected_weight))

            second = self.run_tool(tmp)
            self.assertIn(
                "skip  %s -- every registry layer already present and "
                "correct" % plan,
                second.splitlines(),
                "second run did not report the exact expected skip line "
                "-- got: %r" % second)

            with open(plan, "rb") as fh:
                self.assertEqual(
                    plan_after, fh.read(),
                    "the tool rewrote an already-current PLAN template "
                    "on a second run -- it is supposed to be a no-op "
                    "once every layer is present")

    def test_the_shipped_template_needs_nothing_added(self):
        """The tool has been run against the real template, so a run
        over the shipped bytes must be the pure skip path. This is what
        catches a layer added to the registry and never poured into the
        template -- the exact drift the hand-written-list tools kept
        producing."""
        with tempfile.TemporaryDirectory() as tmp:
            plan = self.make_fake_repo(
                tmp, self.shipped("NSS_Cave_Template_PLAN.dxf")
                .encode("utf-8"))
            output = self.run_tool(tmp)
            self.assertIn(
                "skip  %s -- every registry layer already present and "
                "correct" % plan,
                output.splitlines(),
                "the shipped template is missing a registry layer -- "
                "re-run tools/sync_template_layers.js. Got: %r" % output)

    def test_reports_failure_and_creates_nothing_when_template_is_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            plan = self.make_fake_repo(tmp, plan_bytes=None)

            output = self.run_tool(tmp)

            self.assertIn(
                "FAIL  cannot read " + plan, output.splitlines(),
                "importFile failure on a missing template did not "
                "produce the exact expected FAIL line -- got: %r" %
                output)
            self.assertIn("### SYNC TEMPLATE LAYERS FAIL",
                          output.splitlines())
            self.assertFalse(
                os.path.exists(plan),
                "the tool created a template file after failing to read "
                "one that did not exist -- an ignored importFile "
                "failure would do exactly this")

    def test_reports_failure_and_leaves_file_untouched_when_export_fails(self):
        pre_bytes = self.pre_migration_plan()

        with tempfile.TemporaryDirectory() as tmp:
            plan = self.make_fake_repo(tmp, pre_bytes)
            # A read-only target FILE: importFile can still read it (Qt
            # opens for read), but exportFile's rewrite-in-place cannot
            # open it for writing -- a real, reproducible way to trigger
            # the exportFile FAIL branch rather than assuming it can
            # never fire. (A read-only DIRECTORY with a writable file
            # inside does NOT reproduce this: the exporter truncates the
            # existing file in place rather than replacing it, which
            # only needs write permission on the file itself.)
            os.chmod(plan, 0o444)
            try:
                output = self.run_tool(tmp)
            finally:
                os.chmod(plan, 0o644)

            self.assertIn(
                "FAIL  cannot write " + plan, output.splitlines(),
                "exportFile failure on a read-only FILE did not "
                "produce the exact expected FAIL line -- got: %r" %
                output)
            self.assertIn("### SYNC TEMPLATE LAYERS FAIL",
                          output.splitlines())
            with open(plan, "rb") as fh:
                after_bytes = fh.read()
            self.assertEqual(
                pre_bytes, after_bytes,
                "the file changed even though exportFile is supposed to "
                "have failed -- an ignored exportFile failure would "
                "silently succeed here instead of leaving the "
                "pre-migration bytes alone")

    def test_reports_failure_and_writes_nothing_when_the_registry_is_empty(self):
        """The tool's own floor check. Without it, a broken include or a
        renamed namespace yields an empty wanted-list, every layer counts
        as "already present", and the run reports success over a template
        it never looked at -- silence that reads exactly like the skip
        path above.
        """
        with tempfile.TemporaryDirectory() as tmp:
            core = os.path.join(tmp, "scripts", "CaveSurvey", "Core")
            os.makedirs(core)
            with open(os.path.join(core, "CsLayers.js"), "w") as fh:
                fh.write('var CsLayers = {};\n'
                         'CsLayers.CTRL_SHOTS = "CTRL-SHOTS";\n')
            os.mkdir(os.path.join(tmp, "templates"))
            plan = os.path.join(tmp, "templates",
                                "NSS_Cave_Template_PLAN.dxf")
            pre_bytes = self.pre_migration_plan()
            with open(plan, "wb") as fh:
                fh.write(pre_bytes)

            output = self.run_tool(tmp)

            self.assertIn(
                "FAIL  the layer registry yielded only 1 name(s) -- "
                "CsLayers did not load", output.splitlines(),
                "a one-constant registry did not trip the floor check "
                "-- got: %r" % output)
            self.assertIn("### SYNC TEMPLATE LAYERS FAIL",
                          output.splitlines())
            with open(plan, "rb") as fh:
                self.assertEqual(
                    pre_bytes, fh.read(),
                    "the tool wrote the template despite failing its own "
                    "floor check")


class TestReadmeToolTable(unittest.TestCase):
    """The README's tool table and the shipped tools must agree.

    Nothing reads the README, so it drifts silently. It advertised
    `LRUD Walls` (`lw`) for some time after that standalone tool was
    deleted and its work folded into CsDraw.survey -- a reader would have
    gone hunting the menu for a tool that no longer existed. Four shipped
    tools were meanwhile listed nowhere at all.

    Keyed on the COMMAND ALIAS, not the folder name: CaveTemplate/ ships
    as `newcavemap`/`ncm`, so folder names and commands genuinely differ.
    """

    def readme_table_aliases(self):
        with open(os.path.join(REPO, "README.md"), encoding="utf-8") as fh:
            readme = fh.read()
        # Scope to the tool table's own section -- the README has other
        # tables whose second column is also backticked (install paths),
        # and matching those made this test fail on its first run.
        section = re.search(r"^## The tools\n(.*?)^## ", readme,
                            re.M | re.S)
        self.assertIsNotNone(section, "README has no '## The tools' section")
        # Rows look like: | Display Name | `alias` | description |
        rows = re.findall(r"^\|[^|]+\|\s*`([^`]+)`\s*\|",
                          section.group(1), re.M)
        return set(rows)

    def aliases_by_tool(self):
        """tool folder -> every alias it declares in setDefaultCommands."""
        out = {}
        for name in tool_dirs():
            match = re.search(r"setDefaultCommands\(\[([^\]]*)\]\)",
                              tool_source(name))
            if match is None:
                continue
            out[name] = set(re.findall(r'"([^"]+)"', match.group(1)))
        return out

    # Tools that live in the repo but are deliberately not shipped -- see
    # PARKED_TOOLS in tools/make_package.sh. A parked tool must NOT appear in
    # the README's table, because that table documents what a user gets.
    # Kept after Trip Focus's tool folder was removed (docs/FROZEN.md):
    # it costs nothing, and it means a reintroduced parked tool is
    # exempted and README-checked correctly from its first commit rather
    # than after someone rediscovers this set.
    PARKED = {"TripFocus"}

    def test_a_parked_tool_is_absent_from_the_readme_table(self):
        listed = self.readme_table_aliases()
        by_tool = self.aliases_by_tool()
        leaked = sorted(name for name in self.PARKED
                        if name in by_tool and (by_tool[name] & listed))
        self.assertEqual(leaked, [],
                         "these tools are parked (not shipped) but the README "
                         "advertises them: %s" % leaked)

    def test_every_tool_appears_in_the_readme_table(self):
        # ANY of a tool's aliases counts: the table documents the short
        # form (`snb`) while setDefaultCommands lists the long one first
        # ("surveynotebook"). Requiring the first alias specifically was
        # this test's own bug on its first run, not the README's.
        listed = self.readme_table_aliases()
        by_tool = self.aliases_by_tool()
        missing = sorted(name for name, aliases in by_tool.items()
                         if name not in self.PARKED and not (aliases & listed))
        self.assertEqual(missing, [],
                         "these tools ship but no alias of theirs appears "
                         "in the README's tool table: %s" % missing)

    def test_readme_table_advertises_no_tool_that_does_not_exist(self):
        every_alias = set()
        for aliases in self.aliases_by_tool().values():
            every_alias.update(aliases)
        phantom = sorted(a for a in self.readme_table_aliases()
                         if a not in every_alias)
        self.assertEqual(phantom, [],
                         "the README table advertises commands no tool "
                         "declares: %s" % phantom)


# ---------------------------------------------------------------------
# Shipped template vs the layer registry.
# ---------------------------------------------------------------------
#
# CsLayers.ensure() resolves a layer's appearance at CREATION ONLY.
# Once a layer exists in the shipped template, editing its
# CsLayers.DEFAULTS row does not recolour it, and re-running
# tools/sync_template_layers.js does not either -- that tool only ADDS
# layers it cannot find. So the registry and the template can silently
# disagree, and since every new drawing is born from the template, a
# disagreement means the SAME cave map looks different depending on
# whether the caver started from the template or not.
#
# This already shipped once: NOTES-ELEVATION and NOTES-ELEVATION-LINE
# went out with their colours inverted -- the unmeasured fallback
# brighter than the real reading -- and nothing objected, because the
# only checks were name presence
# (test_registry_layers_exist_in_plan_template) and a sync-tool test
# that compares DEFAULTS against itself.
#
# THE DRIFT IS GONE, 2026-08-31. It used to be recorded here rather than
# fixed -- sixteen of the registry's layers disagreed with the template,
# and the note said resolving them was deferred until "a layer rewrite
# [that] is coming and will need to touch all of it anyway". That rewrite
# happened: the palette in CsLayers.DEFAULTS was rebuilt on one colour/
# weight/linetype scheme, every PROFILE- and SECTION- twin became a
# DERIVED copy of its plan row instead of a hand-written one, and
# tools/sync_template_layers.js learned to RESTYLE the layers it finds
# and not only the ones it creates -- which is the mechanism that had
# made the drift unfixable in the first place.
#
# Each recorded divergence was decided rather than split: ENTRANCE kept
# the template's red at 0.50 (NSS convention, and the registry's white
# was the accident); CROSS-SECTION-MARKERS moved to red with the rest of
# the reference family; WALLS-INFERRED kept the template's NSS_INFERRED
# linetype -- the template WAS right about that -- and took the
# registry's gray, because a white inferred wall renders identically to a
# surveyed one; BREAKDOWN-BOUNDARY likewise kept NSS_DOTTED and went
# gray; the 0x7f7f7f/0x808080 grey spellings collapsed onto SVG gray.
#
# The table stays, empty, and so do both tests. Emptying it is not the
# same as deleting it: an entry here is how a FUTURE deliberate
# divergence gets recorded, and the stale-entry test is what stops one
# rotting. An empty table plus a green suite is the strongest statement
# available -- the shipped template and the registry agree on colour,
# linetype and lineweight for all 196 layers, and any new disagreement
# fails immediately.
#
# name -> {"color": truecolor, "linetype": str, "lineweight": int}
# Only the keys that actually diverge are listed per layer.
TEMPLATE_APPEARANCE_DRIFT = {}


class TestTemplateMatchesRegistry(unittest.TestCase):
    """The shipped template's layer appearance against CsLayers.DEFAULTS.

    Companion to TestLayerVocabulary (which checks PRESENCE) and to
    TestSyncTemplateLayersTool (which checks that the sync tool APPLIES
    DEFAULTS when it creates a layer, and therefore cannot catch a
    template that already disagrees).
    """

    def template_records(self):
        path = os.path.join(TEMPLATES, "NSS_Cave_Template_PLAN.dxf")
        with open(path, encoding="utf-8", errors="replace") as fh:
            return parse_layer_records(fh.read())

    @staticmethod
    def nominal_lineweight(key):
        """"Weight025" -> 25. The DXF stores hundredths of a mm in
        group 370 and the registry names the same number."""
        match = re.match(r"Weight(\d+)$", key)
        assert match is not None, ("unrecognised lineweight key %r -- "
                                  "extend nominal_lineweight()" % key)
        return int(match.group(1))

    def test_shipped_template_appearance_matches_registry(self):
        defaults = parse_defaults_table()
        records = self.template_records()

        for name in sorted(defaults):
            color_name, linetype, weight_key = defaults[name]
            record = records.get(name)
            if record is None:
                # Presence is TestLayerVocabulary's job, not this test's.
                continue
            drift = TEMPLATE_APPEARANCE_DRIFT.get(name, {})

            expected_color = drift.get("color", SVG_TRUE_COLOR[color_name])
            self.assertEqual(
                record["truecolor"], expected_color,
                "%s: template truecolor 0x%06X, expected 0x%06X (%s). "
                "If this layer's appearance was deliberately changed, "
                "update CsLayers.DEFAULTS and re-sync the template, or "
                "record the divergence in TEMPLATE_APPEARANCE_DRIFT with "
                "a reason." % (name, record["truecolor"] or 0,
                               expected_color, color_name))

            # Linetype compares case-insensitively: the template writes
            # "Continuous" and the registry "CONTINUOUS" for 35 layers,
            # which is spelling, not drift.
            expected_lt = drift.get("linetype", linetype)
            self.assertEqual(
                (record["linetype"] or "").upper(), expected_lt.upper(),
                "%s: template linetype %r, expected %r"
                % (name, record["linetype"], expected_lt))

            expected_lw = drift.get(
                "lineweight", self.nominal_lineweight(weight_key))
            self.assertEqual(
                record["lineweight"], expected_lw,
                "%s: template lineweight %r, expected %r (%s)"
                % (name, record["lineweight"], expected_lw, weight_key))

    def test_drift_table_has_no_stale_entries(self):
        """A recorded divergence that no longer diverges must be removed.

        Without this, resolving a drift leaves a false record behind
        saying the template and registry disagree when they now agree --
        and the next reader trusts it.
        """
        defaults = parse_defaults_table()
        records = self.template_records()
        stale = []

        for name, drift in sorted(TEMPLATE_APPEARANCE_DRIFT.items()):
            record = records.get(name)
            if record is None or name not in defaults:
                stale.append("%s (no longer in template or registry)" % name)
                continue
            color_name, linetype, weight_key = defaults[name]
            for field, recorded in sorted(drift.items()):
                if field == "color":
                    actual_default = SVG_TRUE_COLOR[color_name]
                    now = record["truecolor"]
                elif field == "linetype":
                    actual_default = linetype.upper()
                    now = (record["linetype"] or "").upper()
                    recorded = recorded.upper()
                else:
                    actual_default = self.nominal_lineweight(weight_key)
                    now = record["lineweight"]
                if now == actual_default:
                    stale.append("%s[%s] now AGREES with the registry"
                                 % (name, field))
                elif now != recorded:
                    stale.append("%s[%s] drifted again: recorded %r, now %r"
                                 % (name, field, recorded, now))

        self.assertEqual(
            stale, [],
            "TEMPLATE_APPEARANCE_DRIFT is out of date -- remove or "
            "correct these entries: %s" % stale)


class TestEngineTestsLoadEveryCoreFile(unittest.TestCase):
    """tests/js_unit.js loads Core files by a hand-written list, not by
    scanning the folder. Adding a Core file and registering it only in
    CsAll.js leaves this suite exercising a library that does not
    contain it -- and because callers wrap format writers and other
    optional work in deliberate try/catch blocks, the missing global
    surfaces as a quiet no-op rather than an error. That is how
    Format/CsTherion.js reached a green suite while doing nothing.

    So every Core file must be either loaded by js_unit.js or named in
    its CORE_FILES_NOT_LOADED list with a reason. Both directions are
    checked: an unaccounted-for file fails, and so does a stale
    exclusion."""

    CORE = None

    def setUp(self):
        self.core = os.path.join(ADDON, "Core")
        with open(os.path.join(REPO, "tests", "js_unit.js")) as handle:
            self.source = handle.read()

    def _excluded(self):
        """The CORE_FILES_NOT_LOADED entries, and the span they occupy."""
        start = self.source.find("var CORE_FILES_NOT_LOADED = [")
        self.assertNotEqual(
            start, -1,
            "tests/js_unit.js no longer declares CORE_FILES_NOT_LOADED; "
            "this test cannot tell a deliberate omission from an "
            "accident without it")
        end = self.source.find("];", start)
        self.assertNotEqual(end, -1, "CORE_FILES_NOT_LOADED is unterminated")
        span = self.source[start:end]
        return set(self._live_paths(span)), (start, end)

    @staticmethod
    def _live_paths(text):
        """Core paths on lines that are not commented out.

        Parsing live lines rather than grepping the whole file is the
        same precaution TestBasenameCollisions takes: a path inside a
        comment (and every list here carries long explanatory comments)
        would otherwise satisfy the check with the load disabled."""
        found = []
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("//"):
                continue
            found.extend(re.findall(
                r'"scripts/CaveSurvey/Core/([A-Za-z0-9_/]+\.js)"', stripped))
        return found

    def _on_disk(self):
        """Core files, named the way js_unit.js names them: relative to
        Core/ itself (CsUuid.js, Format/CsCsv.js).

        Relative to CORE and not to REPO on purpose -- tools/publish.sh
        runs this suite against a STAGED COPY via CAVESURVEY_ADDON, so
        repo-relative paths would not match the source strings there and
        every Core file would read as unaccounted for."""
        paths = set()
        for dirpath, _dirnames, filenames in os.walk(self.core):
            for filename in filenames:
                if not filename.endswith(".js"):
                    continue
                full = os.path.join(dirpath, filename)
                paths.add(os.path.relpath(full, self.core).replace(os.sep, "/"))
        return paths

    def test_every_core_file_is_loaded_or_explicitly_excluded(self):
        excluded, (start, end) = self._excluded()
        # Everything OUTSIDE the exclusion list: CORE_FILES plus every
        # loadRepoScript call further down the file.
        rest = self.source[:start] + self.source[end:]
        loaded = set(self._live_paths(rest))
        unaccounted = sorted(self._on_disk() - loaded - excluded)
        self.assertEqual(
            unaccounted, [],
            "these Core files are neither loaded by tests/js_unit.js nor "
            "listed in its CORE_FILES_NOT_LOADED: %s -- add them to "
            "CORE_FILES, or to CORE_FILES_NOT_LOADED with the reason "
            "they cannot be loaded there" % unaccounted)

    def test_no_stale_exclusions(self):
        excluded, (start, end) = self._excluded()
        on_disk = self._on_disk()
        gone = sorted(entry for entry in excluded if entry not in on_disk)
        self.assertEqual(
            gone, [],
            "CORE_FILES_NOT_LOADED names files that no longer exist: "
            "%s" % gone)
        rest = self.source[:start] + self.source[end:]
        loaded = set(self._live_paths(rest))
        both = sorted(excluded & loaded)
        self.assertEqual(
            both, [],
            "these files are listed as NOT loaded but tests/js_unit.js "
            "loads them anyway: %s -- drop the stale exclusion" % both)



class TestAddonDoesNotPatchStockPrototypes(unittest.TestCase):
    """An add-on cannot hook a save by wrapping a stock action.

    QCAD builds actions in their own script context
    (RScriptHandlerJs::createActionDocumentLevel), so a prototype
    patched from add-on init is never the prototype the action uses.
    The wrapper installs, reports success, and does nothing -- measured
    2026-08-29 with probe/CsSaveProbe against a real GUI save: armed
    08:15:43, drawing written 08:15:56, probe log never grew.

    CsCave.installSaveHook lived on that mistake for months while
    looking alive, so the failure mode is not "it breaks", it is "it
    silently never runs". The working path is the fork's own Save.js
    calling CsCave.afterSave (patch 0006). This test exists so the
    inert shape cannot come back."""

    PATCH = re.compile(
        r'\b(Save|SaveAs|File|Open|Export)\s*\.\s*prototype\s*\.\s*'
        r'[A-Za-z_]\w*\s*=')

    def test_no_stock_action_prototype_is_reassigned(self):
        offenders = []
        for dirpath, _dirnames, filenames in os.walk(ADDON):
            for filename in sorted(filenames):
                if not filename.endswith(".js"):
                    continue
                full = os.path.join(dirpath, filename)
                with open(full) as handle:
                    for number, line in enumerate(handle, 1):
                        stripped = line.strip()
                        # Comments describe the trap on purpose -- the
                        # note in CsCave.js names the very assignment
                        # this test forbids.
                        if stripped.startswith("//") or \
                                stripped.startswith("*"):
                            continue
                        if self.PATCH.search(stripped):
                            offenders.append("%s:%d" % (
                                os.path.relpath(full, REPO), number))
        self.assertEqual(
            offenders, [],
            "these lines wrap a stock action prototype, which an add-on "
            "cannot make fire: %s -- put the work in a fork patch and "
            "call into the add-on from there, the way Save.js calls "
            "CsCave.afterSave" % offenders)


# The menu, as one table. Every ACTION on the Cave Survey menu: which
# file registers it, its stage (groupSortOrder), its position within the
# stage (sortOrder) and its typed commands.
#
# Keyed by registering file, not by tool folder, and that distinction is
# the whole reason this table earns its keep. Most tools register one
# action from <Tool>/<Tool>.js, but a tool folder may hold sibling files
# that register menu actions of their own. SketchSection USED TO,
# twice -- SectionCapture.js and SectionEdit.js each had their own menu
# entry -- and a table keyed by folder could not see those: the first
# version of it did not, both siblings kept the old flat 450 and landed
# in "Start here", where a beginner met "Capture Section" before ever
# cutting a section. Nothing failed. It was only visible in the running
# menu. Both are gone from this table now, not moved: Capture and Reopen
# are routes in CrossSection's own dialog and buttons on a dock panel,
# not menu entries with a groupSortOrder/sortOrder of their own to get
# wrong a second time.
#
# The six stages, in the order a student works:
#   450 start here            453 put a reference under the map
#   451 survey data           454 finish the sheet
#   452 draw the map          455 fix and share
#
# The engine draws the separators: RGuiAction::addToWidget inserts one
# whenever an action arrives carrying a groupSortOrder the widget has
# not seen, and fixSeparators hides the trailing one. So six stages
# means five visible separators and no UI code of our own.
MENU = {
    # 450 -- start here
    "StartHere/StartHere.js":             (450, 5, ["starthere", "sh"]),
    "Handbook/Handbook.js":               (450, 10, ["handbook", "hb"]),
    "CaveShelf/CaveShelf.js":             (450, 20, ["caveshelf", "caves"]),
    "CaveTemplate/CaveTemplate.js":       (450, 30, ["newcavemap", "ncm"]),
    "TeachingCave/TeachingCave.js":       (450, 40, ["teachingcave", "teach"]),
    "ResetDrawing/ResetDrawing.js":       (450, 41, ["resetdrawing", "rd"]),
    # 451 -- survey data
    "SurveyNotebook/SurveyNotebook.js":   (451, 10, ["surveynotebook", "snb"]),
    "StationTable/StationTable.js":       (451, 12, ["stationtable", "st"]),
    "ExpeditionPlanner/ExpeditionPlanner.js": (451, 13, ["expeditionplanner", "epl"]),
    "ImportCaveSurvey/ImportCaveSurvey.js": (451, 20, ["importcavesurvey", "ics"]),
    "ExportCaveSurvey/ExportCaveSurvey.js": (451, 30, ["exportcavesurvey", "ecs"]),
    "LoopErrors/LoopErrors.js":           (451, 40, ["looperrors", "le"]),
    "Cave3D/Cave3D.js":                   (451, 50, ["cave3d", "c3"]),
    # 452 -- draw the map
    "DrawPanel/DrawPanel.js":             (452, 10, ["draw", "ft", "sym", "area"]),
    "ShapedLines/ShapedLines.js":         (452, 20, ["shapedlines", "shl"]),
    "ShapedLines/WallEdging.js":          (452, 36, ["walledging", "wed"]),
    "LinetypeMaker/LinetypeMaker.js":     (452, 45, ["linetypemaker", "ltm"]),
    "ScatterBreakdown/ScatterBreakdown.js": (452, 30, ["scatterbreakdown", "scb"]),
    "AreaSync/AreaSync.js":               (452, 35, ["syncareas", "sya"]),
    "CrossSection/CrossSection.js":       (452, 40, ["crosssection", "cxs"]),
    # 453 -- put a reference under the map
    "SketchScans/SketchScans.js":         (453, 10, ["sketchscans", "ss"]),
    "EntranceLocation/EntranceLocation.js": (453, 15,
                                          ["entrancelocation", "el"]),
    "SurfaceData/SurfaceData.js":         (453, 20, ["surfacedata", "sd"]),
    # 454 -- finish the sheet
    "SheetSetup/SheetSetup.js":           (454, 5, ["sheetsetup", "sheet"]),
    "SurveyStats/SurveyStats.js":         (454, 10, ["surveystats", "sst"]),
    "GenerateProfile/GenerateProfile.js": (454, 20, ["generateprofile", "gp", "genprofile"]),
    "BuildLegend/BuildLegend.js":         (454, 30, ["buildlegend", "bl"]),
    "Callout/Callout.js":                 (454, 40, ["callout", "cal", "cscallout", "cscal"]),
    "LayoutNorthArrow/LayoutNorthArrow.js": (454, 60, ["northarrow", "nar"]),
    "LayoutScaleBar/LayoutScaleBar.js":   (454, 61, ["scalebar", "sbar"]),
    "LayoutTitleBlock/LayoutTitleBlock.js": (454, 62, ["titleblock", "tblock"]),
    "LayoutNew/LayoutNew.js":             (454, 63, ["newlayout", "nlay"]),
    "LayoutSaveTemplate/LayoutSaveTemplate.js": (454, 64, ["savelayout", "slay"]),
    "LayoutBorder/LayoutBorder.js":       (454, 65, ["addborder", "abrd"]),
    "LayoutLegend/LayoutLegend.js":       (454, 66, ["addlegend", "alg"]),
    "LayoutPlot/LayoutPlot.js":           (454, 67, ["plotlayout", "plot"]),
    "LayoutZoomViewport/LayoutZoomViewport.js": (454, 68, ["zoomviewport", "zvp"]),
    "LayoutMatchViewport/LayoutMatchViewport.js": (454, 69, ["matchviewport", "mvp"]),
    "LayoutCheck/LayoutCheck.js":         (454, 70, ["checksheet", "chs"]),
    "LayoutDetail/LayoutDetail.js":       (454, 71, ["detail", "dtl"]),
    "LayoutIndex/LayoutIndex.js":         (454, 72, ["sheetindex", "sidx"]),
    "LayoutGrid/LayoutGrid.js":           (454, 73, ["addgrid", "grid"]),
    # 455 -- fix and share
    "CheckMap/CheckMap.js":               (455, 5, ["checkmap", "chk"]),
    "RepairDrawing/RepairDrawing.js":     (455, 10, ["repairdrawing", "rep"]),
    "PackageCave/PackageCave.js":         (455, 20, ["packagecave", "pc", "pkgcave"]),
}


def menu_registrars():
    """Every add-on file that puts an action on the Cave Survey menu.

    Found by what the file DOES -- naming CaveSurveyMenu in a
    setWidgetNames call -- rather than by where it sits, so a sibling
    file inside a tool folder counts exactly as much as the tool's own.
    Paths are relative to the add-on root, with forward slashes on every
    platform, because they are dictionary keys above.
    """
    out = []
    for folder, _subdirs, files in os.walk(ADDON):
        for name in files:
            if not name.endswith(".js"):
                continue
            path = os.path.join(folder, name)
            with open(path) as fh:
                source = fh.read()
            if "CaveSurveyMenu" not in source:
                continue
            if "setWidgetNames" not in source:
                continue
            rel = os.path.relpath(path, ADDON)
            if rel == "CaveSurvey.js":
                # The menu host. It CREATES the two widgets and shows
                # the registration shape in its own comments; it puts
                # nothing on the menu itself.
                continue
            out.append(rel.replace(os.sep, "/"))
    return sorted(out)


def registrar_source(rel):
    with open(os.path.join(ADDON, *rel.split("/"))) as fh:
        return fh.read()


class TestMenuTable(unittest.TestCase):
    """The menu is a table, and the table is the spec.

    Every entry a caver sees under Cave Survey is one row here, carrying
    the stage it belongs to and the commands that reach it. A tool that
    moves stage, gains an alias or leaves the menu entirely is meant to
    be an edit to this table AND to the tool; an edit to only one of the
    two fails here, which is the point.
    """

    def test_every_menu_action_is_in_the_table(self):
        missing = sorted(set(menu_registrars()) - set(MENU))
        self.assertEqual([], missing,
                         "file registers a menu action but is not in "
                         "MENU: %s" % missing)

    def test_table_names_no_file_that_does_not_exist(self):
        extra = sorted(set(MENU) - set(menu_registrars()))
        self.assertEqual([], extra,
                         "MENU names a file that registers no menu "
                         "action: %s" % extra)

    def test_every_action_registers_the_stage_and_position(self):
        for rel, (group, order, _cmds) in sorted(MENU.items()):
            source = registrar_source(rel)
            self.assertEqual(
                group, find_int(source, "action.setGroupSortOrder"),
                "%s is in the wrong menu stage" % rel)
            self.assertEqual(
                order, find_int(source, "action.setSortOrder"),
                "%s is in the wrong position within its stage" % rel)

    def test_every_action_registers_the_commands_in_the_table(self):
        for rel, (_group, _order, cmds) in sorted(MENU.items()):
            source = registrar_source(rel)
            match = re.search(r"setDefaultCommands\(\[(.*?)\]\)", source, re.S)
            self.assertIsNotNone(match, "%s sets no commands" % rel)
            found = re.findall(r'"([^"]+)"', match.group(1))
            self.assertEqual(cmds, found,
                             "%s registers the wrong commands" % rel)

    def test_no_two_actions_share_a_stage_and_position(self):
        """A collision means one entry silently displaces the other."""
        seen = {}
        for rel, (group, order, _cmds) in sorted(MENU.items()):
            key = (group, order)
            self.assertNotIn(
                key, seen,
                "%s and %s both claim stage %d position %d"
                % (seen.get(key), rel, group, order))
            seen[key] = rel


class TestSignalsConnectToFunctions(unittest.TestCase):
    """A signal is connected to a FUNCTION, never to a slot NAME.

    `bb.accepted.connect(dlg, "accept")` is the Qt Script idiom, and it
    THROWS in this build -- "Function.prototype.connect: target is not a
    function" -- because the engine's connect takes a function, or a
    receiver plus a function, and never a string. It throws where the
    dialog is BUILT, so the tool dies before anything is shown, and the
    caver sees a tool that does nothing.

    Found 2026-09-06 when Symbol Palette's Save Symbol reported it; four
    shipped tools (Cross Section, Callout, Repair Drawing, Surface Data)
    carried the same line and were broken the same way. No headless test
    can reach it -- it needs a real QDialog -- so it is pinned here as
    source, which is the only place it can be caught cheaply.
    """

    SLOT_NAME = re.compile(r'\.connect\(\s*[A-Za-z_$][A-Za-z0-9_$]*\s*,\s*"')

    def test_no_signal_connects_to_a_slot_name(self):
        offenders = []
        for dirpath, _dirnames, filenames in os.walk(ADDON):
            for filename in sorted(filenames):
                if not filename.endswith(".js"):
                    continue
                path = os.path.join(dirpath, filename)
                with open(path) as handle:
                    for number, line in enumerate(handle, 1):
                        stripped = line.strip()
                        if stripped.startswith("//") or stripped.startswith("*"):
                            continue
                        if self.SLOT_NAME.search(line):
                            rel = os.path.relpath(path, ADDON)
                            offenders.append("%s:%d" % (rel, number))
        self.assertEqual(
            [], offenders,
            "these connect a signal to a slot NAME, which throws in this "
            "build -- pass a function instead: %s" % offenders)


class TestNoWidgetDestroy(unittest.TestCase):
    """Nothing calls destroy() on a widget.

    It THROWS in this build -- "Invalid attempt to destroy() an
    indestructible object" -- for a parented dialog and an unparented
    one alike, measured against the running application 2026-09-06. It
    threw at the end of every dialog in the suite, AFTER the caver had
    answered, so their answer was thrown away with the exception. Close
    it and let Qt delete it.
    """

    DESTROY = re.compile(r"^[^/*]*\.destroy\(\)")

    def test_no_widget_is_destroyed(self):
        offenders = []
        for dirpath, _dirnames, filenames in os.walk(ADDON):
            for filename in sorted(filenames):
                if not filename.endswith(".js"):
                    continue
                path = os.path.join(dirpath, filename)
                with open(path) as handle:
                    for number, line in enumerate(handle, 1):
                        stripped = line.strip()
                        if stripped.startswith("//") or stripped.startswith("*"):
                            continue
                        if self.DESTROY.search(line):
                            rel = os.path.relpath(path, ADDON)
                            offenders.append("%s:%d" % (rel, number))
        self.assertEqual(
            [], offenders,
            "destroy() throws in this build; close() and deleteLater() "
            "instead: %s" % offenders)


class TestNamespacesAreDeclared(unittest.TestCase):
    """A file that assigns onto a namespace must create it first.

    Twice now, folding a tool into another tool has deleted the
    `function Foo(guiAction)` constructor the menu entry needed -- and
    with it the object that every `Foo.bar = ...` in the file was
    assigning onto. The first such assignment then throws a
    ReferenceError at load time and takes the whole file with it,
    silently: the tool's button does nothing and no test notices,
    because the headless suites drive the Core engine directly and
    never load the presenter.

    So: for every `Foo.bar = function` in the add-on, the same file
    must also declare Foo -- as `var Foo`, as `function Foo(`, or by
    assigning it outright.
    """

    ASSIGN = re.compile(r"^([A-Z][A-Za-z0-9_]*)\.[A-Za-z0-9_]+\s*=", re.M)

    def _declares(self, source, name):
        patterns = (
            r"^\s*var\s+%s\s*=" % name,
            r"^\s*function\s+%s\s*\(" % name,
            r"^\s*%s\s*=\s*\{" % name,
        )
        return any(re.search(p, source, re.M) for p in patterns)

    def test_every_assigned_namespace_is_declared_in_its_file(self):
        offenders = []
        for folder, _subdirs, files in os.walk(ADDON):
            for name in sorted(files):
                if not name.endswith(".js"):
                    continue
                path = os.path.join(folder, name)
                with open(path) as handle:
                    source = handle.read()
                rel = os.path.relpath(path, ADDON).replace(os.sep, "/")
                for ns in sorted(set(self.ASSIGN.findall(source))):
                    # Qt and QCAD globals are declared by the engine,
                    # never by us; a file legitimately assigns onto them.
                    if ns.startswith("Q") or ns.startswith("R"):
                        continue
                    if self._declares(source, ns):
                        continue
                    # An assignment onto a namespace another file owns is
                    # fine as long as this file does not also OWN it --
                    # the giveaway is assigning its own primary object.
                    if ns == os.path.splitext(os.path.basename(rel))[0]:
                        offenders.append("%s assigns %s.* but never "
                                         "declares %s" % (rel, ns, ns))
        self.assertEqual([], offenders, "\n".join(offenders))


class TestSheetGuard(unittest.TestCase):
    """A sheet is not a drawing to work in.

    A sheet is a layout: a piece of paper showing the cave. Every tool in
    this suite writes into the CURRENT block, which with a sheet showing is
    the paper -- so a traced passage or a regenerated profile would land in
    paper space and look as if nothing had happened.

    So every tool that WRITES checks CsModelSpace.blocks first. The list
    is written out rather than derived, on the same principle as the
    MENU table: a tool that starts writing has to be added here
    deliberately, and a tool that stops writing has to be taken out.
    """

    # Tools that modify the drawing, and so must refuse a sheet.
    MUST_GUARD = [
        "AreaFill", "AreaSync", "BuildLegend", "Callout", "CrossSection",
        "DrawPanel", "FeatureTrace", "GenerateProfile", "ImportCaveSurvey",
        "LoopErrors", "RepairDrawing", "ScatterBreakdown", "ShapedLines",
        "SketchScans", "SurfaceData", "SurveyNotebook", "SymbolPalette",
        "ResetDrawing", "EntranceLocation", "LinetypeMaker",
    ]

    # Tools that only READ, and are welcome on a sheet: checking a sheet
    # before plotting it is exactly what they are for. Listed with the
    # reason, so moving one across is a decision rather than a drift.
    READ_ONLY = {
        "CheckMap": "reads the drawing and reports; changes nothing",
        "LayoutNorthArrow": "draws on a LAYOUT only (refuses the model); never touches model space",
        "LayoutScaleBar": "draws on a LAYOUT only (refuses the model); never touches model space",
        "LayoutIndex": "draws on a LAYOUT only; never touches model space",
        "LayoutGrid": "draws on a LAYOUT only; never touches model space",
        "LayoutDetail": "adds a viewport and marks on a LAYOUT; never touches model space",
        "LayoutCheck": "reads a layout and reports; changes nothing",
        "LayoutZoomViewport": "changes a viewport's view on a LAYOUT; never touches model space",
        "LayoutMatchViewport": "changes viewports on a LAYOUT; never touches model space",
        "LayoutBorder": "draws on a LAYOUT only (refuses the model); never touches model space",
        "LayoutLegend": "makes a viewport on a LAYOUT; never edits model space (Build Legend does that)",
        "LayoutPlot": "writes a PDF; the only edit is leaving rasters out of viewports on layouts",
        "LayoutNew": "makes a new LAYOUT (paper space) from a template; never touches model space",
        "LayoutSaveTemplate": "reads a layout and writes a template file; never edits the drawing",
        "LayoutTitleBlock": "draws on a LAYOUT only (refuses the model); never touches model space",
        "SurveyStats": "computes length, depth and grade",
        "ExportCaveSurvey": "writes a survey file, never the drawing",
        "PackageCave": "copies a cave folder; never edits a drawing",
        "CaveShelf": "opens drawings, does not edit them",
        "CaveTemplate": "makes a NEW drawing from the template",
        "TeachingCave": "copies files between folders",
        "SheetSetup": "makes and rewrites LAYOUTS only (paper space); "
                      "never touches model space",
        "Cave3D": "opens a window onto the survey; draws no entity",
        "Handbook": "reads its own HTML pages; never the drawing",
        "StartHere": "ticks a checklist in the settings; draws nothing",
        "StationTable": "reads the survey; writes only stations.json "
                        "beside the drawing",
        "ExpeditionPlanner": "reads the survey; writes stations.json "
                             "settings (settings.trip.teams) and "
                             "trip-plan.html / callout-card.html / "
                             "team-*.html beside the drawing; reads "
                             "and writes people.json in the per-user data "
                             "folder; contacts to per-user settings only",
    }

    def guarded(self, folder):
        with open(os.path.join(ADDON, folder, folder + ".js")) as handle:
            return "CsModelSpace.blocks" in handle.read()

    def test_every_editing_tool_refuses_a_sheet(self):
        missing = [name for name in self.MUST_GUARD
                   if not self.guarded(name)]
        self.assertEqual(
            missing, [],
            "these tools write to the drawing but do not refuse a "
            "sheet: %s -- add CsModelSpace.blocks(doc, \"<Tool>\") to "
            "each" % missing)

    # Tools that rewrite the WHOLE drawing: they refuse the inside of a
    # viewport as well (blocksWhole). The rest of MUST_GUARD is interactive
    # hand-drawing, which click-through exists for.
    WHOLE_DRAWING = [
        "AreaSync", "BuildLegend", "DrawPanel", "EntranceLocation",
        "GenerateProfile", "ImportCaveSurvey", "LinetypeMaker", "LoopErrors",
        "RepairDrawing", "ResetDrawing", "ScatterBreakdown", "SketchScans",
        "SurfaceData", "SurveyNotebook",
    ]

    def test_whole_drawing_tools_refuse_the_inside_of_a_viewport(self):
        for name in self.WHOLE_DRAWING:
            self.assertIn(name, self.MUST_GUARD)
            with open(os.path.join(ADDON, name, name + ".js")) as handle:
                self.assertIn("CsModelSpace.blocksWhole", handle.read(), name)
        for name in set(self.MUST_GUARD) - set(self.WHOLE_DRAWING):
            with open(os.path.join(ADDON, name, name + ".js")) as handle:
                self.assertNotIn("CsModelSpace.blocksWhole", handle.read(),
                                 "%s is hand-drawing; click-through must work" % name)

    def test_the_two_lists_cover_every_tool(self):
        """A tool in neither list is a tool nobody decided about."""
        tools = sorted(
            name for name in os.listdir(ADDON)
            if os.path.isfile(os.path.join(ADDON, name, name + ".js")))
        known = set(self.MUST_GUARD) | set(self.READ_ONLY)
        undecided = [name for name in tools if name not in known]
        self.assertEqual(
            undecided, [],
            "these tools are in neither the writing list nor the "
            "read-only one: %s -- decide which, and say why in "
            "READ_ONLY if it reads" % undecided)

    def test_no_sheet_files_are_left(self):
        """Sheets are layouts now; the file-per-sheet machinery is gone."""
        for rel in ("Core/CsSheetFile.js",):
            self.assertFalse(
                os.path.exists(os.path.join(ADDON, rel)),
                "%s belongs to the retired file-per-sheet design" % rel)
        with open(os.path.join(ADDON, "SheetSetup", "SheetSetup.js")) as handle:
            source = handle.read()
        for dead in ("intoCopy", "sheets/", "SHEETS_FOLDER"):
            self.assertNotIn(
                dead, source,
                "Sheet Setup still mentions %r from the retired design" % dead)


class TestPanelsRunInTheApplicationEngine(unittest.TestCase):
    """A docked panel belongs to the application, not to a tab.

    QCAD runs a setRequiresDocument(true) action in the ACTIVE
    DOCUMENT'S OWN script engine (RGuiAction::slotTrigger ->
    createActionDocumentLevel), and every engine has its own globals.
    So a panel opened from a second tab found its `csXDock` empty and
    built a second panel; closing that tab destroyed the engine the
    new panel's buttons called into. Measured live 2026-09-27: Build
    Sheet did nothing, and hovering an orphaned Sheet Setup preview
    crashed CaveCAD (SIGSEGV in QJSEngine::throwError under
    RActionAdapter_Base::mouseMoveEvent).

    setForceGlobal(true) -- the flag stock Print Preview uses -- keeps
    the button greyed without a document but runs the action in the
    application's engine, where init() built the one and only dock.
    """

    # Every action whose beginEvent opens a dock. Written out, like
    # MUST_GUARD above; the derived test below catches one left off.
    PANEL_OPENERS = [
        "AreaFill", "CheckMap", "DrawPanel", "FeatureTrace", "SheetSetup",
        "SketchScans", "SymbolPalette",
    ]

    # Already application-level: they never require a document at all.
    NO_DOCUMENT_NEEDED = ["CaveShelf", "Handbook", "LinetypeMaker",
                          "StartHere", "SurveyNotebook"]

    def source(self, folder):
        with open(os.path.join(ADDON, folder, folder + ".js")) as handle:
            return handle.read()

    def begin_event(self, folder):
        match = re.search(r"\.prototype\.beginEvent = function\(\) \{"
                          r"(.*?)\n\};", self.source(folder), re.S)
        return match.group(1) if match else ""

    def test_every_panel_opener_runs_in_the_application_engine(self):
        missing = [name for name in self.PANEL_OPENERS
                   if "action.setForceGlobal(true)" not in self.source(name)]
        self.assertEqual(
            missing, [],
            "these tools open a docked panel from a document's own "
            "script engine, so a second tab builds a second panel and "
            "closing it leaves one wired to a dead engine: %s -- add "
            "action.setForceGlobal(true) after setRequiresDocument"
            % missing)

    def test_no_panel_opener_is_left_off_the_list(self):
        tools = sorted(
            name for name in os.listdir(ADDON)
            if os.path.isfile(os.path.join(ADDON, name, name + ".js")))
        opens = [name for name in tools
                 if re.search(r"ensureDock\(|DrawPanel\.reveal\(|"
                              r"sketchScansRun\(",
                              self.begin_event(name))]
        undecided = [name for name in opens
                     if name not in self.PANEL_OPENERS
                     and name not in self.NO_DOCUMENT_NEEDED]
        self.assertEqual(
            undecided, [],
            "these tools open a panel from beginEvent but are not in "
            "PANEL_OPENERS: %s" % undecided)

    def test_panel_openers_read_the_document_statically(self):
        """An application-level action has no document of its own, so
        this.getDocument() answers null and the sheet guard would wave
        a sheet through."""
        uses = [name for name in self.PANEL_OPENERS
                if "this.getDocument()" in self.begin_event(name)]
        self.assertEqual(
            uses, [],
            "use EAction.getDocument() in these beginEvents: %s" % uses)

    def test_a_live_dock_is_never_forgotten(self):
        """Forgetting a dock that WAS built, because something after it
        threw, makes the next press build a second one beside it."""
        careless = []
        for name in self.PANEL_OPENERS:
            if re.search(r"catch \(e\) \{\s*cs\w+Dock = undefined;",
                         self.source(name)):
                careless.append(name)
        self.assertEqual(
            careless, [],
            "these forget their dock in a catch without checking it "
            "was never built: %s" % careless)

    def test_sheet_setup_never_refuses_silently(self):
        """warning() is qWarning: stderr, which a caver never sees. The
        "save first" refusal went there and Build Sheet looked dead."""
        source = self.source("SheetSetup")
        build = re.search(r"\nSheetSetup\.build = function\(\) \{(.*?)\n\};",
                          source, re.S).group(1)
        code = re.sub(r"//[^\n]*", "", build)
        self.assertIsNone(re.search(r"(?<![\w.])warning\(", code),
                          "SheetSetup.build calls warning(); use "
                          "SheetSetup.tell so the caver sees it")
        self.assertIn("SheetSetup.tell(", code)

    def test_sheet_setup_says_how_serious_each_message_is(self):
        """Green done, yellow warning, red error -- a success once came
        out red and read as a failure. Every call names its level."""
        source = self.source("SheetSetup")
        calls = re.findall(r"SheetSetup\.tell\((.*?)\);\n", source, re.S)
        unlevelled = [c[:60] for c in calls
                      if not re.search(r"SheetSetup\.(DONE|WARNING|ERROR)", c)]
        self.assertTrue(calls)
        self.assertEqual(unlevelled, [],
                         "SheetSetup.tell calls without a level: %s"
                         % unlevelled)


class TestUserMessagesAreSeen(unittest.TestCase):
    """warning() is qWarning: stderr, which a caver never sees.

    Sheet Setup's "save this drawing first" went through it and Build
    Sheet looked like a dead button (0.9.181.3). Anything a caver's
    press can reach -- a beginEvent, a connected handler, and what
    those call in the same file -- says it through CsTell.warn (or the
    tool's own note line) instead. warning() is left for developer
    diagnostics: a panel partly refused at startup, a listener that
    would not attach.
    """

    WARNING = re.compile(r"(?<![\w.])warning\(")

    # Reachable from a press, and still deliberately warning(): the
    # caver can do nothing about either, and a box would come up at
    # every panel build on a broken bridge.
    DIAGNOSTICS = {
        ("DrawPanel/DrawPanel.js", "Draw: this CaveCAD build refused "),
        ("FeatureTrace/FeatureTrace.js",
         "Feature Trace: this CaveCAD build refused: "),
        ("FeatureTrace/FeatureTrace.js",
         "Feature Trace: could not watch the drawing for survey "),
    }

    @staticmethod
    def strip_comments(source):
        source = re.sub(r"/\*.*?\*/", "", source, flags=re.S)
        return re.sub(r"(?m)(^|[^:\\\"'])//[^\n]*", r"\1", source)

    @staticmethod
    def block_at(source, brace):
        """The text from the { at `brace` to its matching }."""
        depth = 0
        for i in range(brace, len(source)):
            if source[i] == "{":
                depth += 1
            elif source[i] == "}":
                depth -= 1
                if depth == 0:
                    return source[brace:i + 1]
        return source[brace:]

    def definitions(self, source):
        """name -> body, for `Foo.bar = function` and `function foo(`."""
        found = {}
        for m in re.finditer(r"(?m)^([A-Za-z_][\w.]*)\s*=\s*function\s*"
                             r"\([^)]*\)\s*\{|^function\s+(\w+)\s*\("
                             r"[^)]*\)\s*\{", source):
            name = m.group(1) or m.group(2)
            found[name] = self.block_at(source, m.end() - 1)
        return found

    def reachable(self, source):
        """The code a press can run: beginEvents and connected handlers,
        then whatever same-file functions they call, transitively."""
        defs = self.definitions(source)
        todo = [body for name, body in defs.items()
                if name.endswith(".prototype.beginEvent")]
        for m in re.finditer(r"\.connect\(\s*function\s*\([^)]*\)\s*\{",
                             source):
            todo.append(self.block_at(source, m.end() - 1))
        for m in re.finditer(r"\.connect\(\s*([A-Za-z_][\w.]*)\s*\)",
                             source):
            if m.group(1) in defs:
                todo.append(defs[m.group(1)])
        seen, bodies = set(), []
        while todo:
            body = todo.pop()
            if body in seen:
                continue
            seen.add(body)
            bodies.append(body)
            for call in re.findall(r"(?<![\w.])([A-Za-z_][\w.]*)\s*\(",
                                   body):
                if call in defs:
                    todo.append(defs[call])
        return bodies

    def test_no_press_ends_in_warning(self):
        offenders = []
        for folder, _subdirs, files in os.walk(ADDON):
            for name in sorted(files):
                if not name.endswith(".js"):
                    continue
                path = os.path.join(folder, name)
                rel = os.path.relpath(path, ADDON).replace(os.sep, "/")
                with open(path) as handle:
                    source = self.strip_comments(handle.read())
                for body in self.reachable(source):
                    for m in self.WARNING.finditer(body):
                        said = re.match(r"\s*(?:qsTr\()?\"([^\"]*)",
                                        body[m.end():])
                        text = said.group(1) if said else ""
                        if (rel, text) in self.DIAGNOSTICS:
                            continue
                        offenders.append("%s: warning(\"%s...\")"
                                         % (rel, text[:50]))
        self.assertEqual(
            sorted(set(offenders)), [],
            "a caver's press reaches warning(), which only prints to "
            "stderr -- use CsTell.warn, or add it to DIAGNOSTICS if the "
            "caver truly cannot act on it")

    def test_core_never_calls_warning(self):
        """Core is called from other files' handlers, which the reach
        above does not follow -- CsPick and CsSheetFile's refusals were
        both on a press. Only CsTell, the headless fallback, may."""
        core = os.path.join(ADDON, "Core")
        offenders = []
        for name in sorted(os.listdir(core)):
            if not name.endswith(".js") or name == "CsTell.js":
                continue
            with open(os.path.join(core, name)) as handle:
                if self.WARNING.search(self.strip_comments(handle.read())):
                    offenders.append(name)
        self.assertEqual(offenders, [],
                         "Core files calling warning(); use CsTell.warn")

    def test_the_check_would_have_caught_sheet_setup(self):
        """The shape that shipped: a connected closure calling a
        same-file function that refuses through warning()."""
        source = ("var W = {};\n"
                  "W.make = function() {\n"
                  "    b.clicked.connect(function() { W.build(); });\n"
                  "};\n"
                  "W.build = function() {\n"
                  "    warning(\"W: save first\");\n"
                  "};\n")
        bodies = self.reachable(self.strip_comments(source))
        self.assertTrue(any(self.WARNING.search(b) for b in bodies))

    def test_diagnostics_still_exist(self):
        """A DIAGNOSTICS entry whose warning() is gone is stale."""
        missing = []
        for rel, text in sorted(self.DIAGNOSTICS):
            with open(os.path.join(ADDON, rel)) as handle:
                if "warning(\"" + text not in handle.read():
                    missing.append("%s: %s" % (rel, text))
        self.assertEqual(missing, [], "stale DIAGNOSTICS entries")


class TestSectionBayPanelBelongsToTheApplication(unittest.TestCase):
    """The bay panel is opened from Cross Section, which runs in the
    active TAB'S script engine and cannot be setForceGlobal (it needs its
    document for the interactive cut). So the dock is built in init --
    the application engine -- and show/hide reach it by objectName.

    Measured live 2026-09-27: built lazily from the tab engine, a bay in
    a second tab built a second dock, and closing the first tab left a
    dock whose Capture and Cancel called into a destroyed engine.
    """

    def source(self, name):
        with open(os.path.join(ADDON, "CrossSection", name)) as handle:
            code = re.sub(r"/\*.*?\*/", "", handle.read(), flags=re.S)
            return re.sub(r"//[^\n]*", "", code)

    def body(self, source, name):
        match = re.search(r"\nSectionBayPanel\." + name +
                          r" = function\([^)]*\) \{(.*?)\n\};", source, re.S)
        self.assertIsNotNone(match, "SectionBayPanel.%s is gone" % name)
        return match.group(1)

    def test_no_engine_local_dock_cache(self):
        """A module variable holding the dock is empty in every engine
        but the one that set it -- the root of the duplicate."""
        source = self.source("SectionBayPanel.js")
        self.assertIsNone(
            re.search(r"^var \w*[Dd]ock\w* = ", source, re.M),
            "SectionBayPanel caches its dock in a global again; find it "
            "by objectName with SectionBayPanel.dock()")

    def test_show_and_hide_never_build_the_dock(self):
        source = self.source("SectionBayPanel.js")
        for name in ("show", "hide", "follow"):
            code = self.body(source, name)
            self.assertNotIn("ensureDock(", code,
                             "SectionBayPanel.%s builds the dock -- from a "
                             "tab's engine, that is the bug" % name)
            self.assertNotIn("new QDockWidget", code)

    def test_label_is_found_by_name_not_expando(self):
        """`dock.label = ...` exists only on the wrapper of the engine
        that set it; another engine's findChild wrapper has no .label."""
        source = self.source("SectionBayPanel.js")
        self.assertNotIn("dock.label", source)
        self.assertIn("SectionBayPanel.label(", self.body(source, "show"))
        self.assertIn("SectionBayPanel.LABEL_NAME", self.body(source, "label"))

    def test_dock_is_built_from_init_only(self):
        cross = self.source("CrossSection.js")
        init = re.search(r"\nCrossSection\.init = function\(basePath\) \{"
                         r"(.*?)\n\};", cross, re.S).group(1)
        self.assertIn("SectionBayPanel.install()", init)
        begin = re.search(r"\.prototype\.beginEvent = function\(\) \{"
                          r"(.*?)\n\};", cross, re.S).group(1)
        self.assertNotIn("ensureDock(", begin)
        self.assertNotIn("install(", begin)

    def test_panel_follows_the_active_tab(self):
        """Closing the bay's tab has to hide the panel; the MDI area's
        activation signal is what fires when a tab closes."""
        install = self.body(self.source("SectionBayPanel.js"), "install")
        self.assertIn("subWindowActivated.connect", install)
        self.assertIn("SectionBayPanel.follow()", install)

    def test_a_stale_dock_is_retired_before_building(self):
        ensure = self.body(self.source("SectionBayPanel.js"), "ensureDock")
        self.assertIn("SectionBayPanel.retire(", ensure)
        retire = self.body(self.source("SectionBayPanel.js"), "retire")
        self.assertIn("objectName", retire)
        self.assertIn("deleteLater()", retire)


class TestCave3dStatusSaysEachThingOnce(unittest.TestCase):
    """The 3D view's cover reason and terrain reason both come from
    surfaceContext, so a cave with no surface grid printed "no surface:
    run Surface Data..." twice side by side -- and the doubled line held
    the dock too wide to shrink (2026-09-27)."""

    def test_repeated_parts_are_said_once(self):
        with open(os.path.join(ADDON, "Cave3D", "Cave3D.js")) as handle:
            source = handle.read()
        match = re.search(r"\nCave3D\.joinStatus = function\(parts\) \{.*?\n\};",
                          source, re.S)
        self.assertIsNotNone(match, "Cave3D.joinStatus is gone")
        script = ("var Cave3D = {}; function isNull(v) { return v === null "
                  "|| v === undefined; }" + match.group(0) +
                  "; console.log(Cave3D.joinStatus(['Depth', 'no surface', "
                  "'', null, 'no surface']));")
        out = subprocess.run(["node", "-e", script], capture_output=True,
                             text=True, check=True).stdout.strip()
        self.assertEqual(out, "Depth  --  no surface")

    def test_both_status_writers_use_it(self):
        with open(os.path.join(ADDON, "Cave3D", "Cave3D.js")) as handle:
            source = handle.read()
        writes = re.findall(r"cave3d\.setStatus\(Cave3D\.handle,(.*?)\);",
                            source, re.S)
        combined = [w for w in writes if "Why" in w]
        self.assertEqual(len(combined), 2,
                         "expected the build and recolour status writes")
        self.assertEqual([w for w in combined if "joinStatus" not in w], [])



class TestEveryPanelScrolls(unittest.TestCase):
    """Every panel is freely resizable (Nathan, 2026-09-27: "if buttons
    and fields need a minimum size, then the resized panel gets
    scrollbars"). A dock cannot shrink below its widget's minimum, so
    each one's body goes into a scroll area -- CsPanel.makeScrollable,
    which CsPanel.attachHelp calls on every path."""

    def test_every_dock_builder_is_wrapped(self):
        unwrapped = []
        for root, _dirs, files in os.walk(ADDON):
            for name in files:
                if not name.endswith(".js") or name == "CsPanel.js":
                    continue
                with open(os.path.join(root, name)) as handle:
                    source = handle.read()
                if "new QDockWidget" not in source:
                    continue
                if ("CsPanel.attachHelp(" not in source and
                        "CsPanel.makeScrollable(" not in source):
                    unwrapped.append(name)
        self.assertEqual(
            unwrapped, [],
            "these build a dock that cannot shrink below its contents: "
            "%s -- end buildDock with CsPanel.attachHelp or "
            "CsPanel.makeScrollable" % unwrapped)

    def test_attach_help_wraps_on_every_path(self):
        with open(os.path.join(ADDON, "Core", "CsPanel.js")) as handle:
            source = handle.read()
        body = re.search(r"\nCsPanel\.attachHelp = function.*?\n\};",
                         source, re.S).group(0)
        returns = len(re.findall(r"\breturn\b", body))
        wraps = body.count("CsPanel.makeScrollable(dock)")
        self.assertEqual(wraps, returns,
                         "attachHelp has %d exits but wraps the dock on "
                         "%d of them" % (returns, wraps))


class TestScanListIsShared(unittest.TestCase):
    """Two panels show the cave's scans; they must say the same things.

    The list, the tick, the folded folders and the settings behind them
    all moved to Core/CsScanList.js when the Survey Notebook needed the
    same browser Sketch Scans has. The words are part of that: the
    Notebook's own first version said "Finished with" where Sketch Scans
    said "Mark Complete" -- one act, one setting, one tick, two names,
    which is the drift sharing the list was supposed to end.
    """

    def source(self, *parts):
        with open(os.path.join(ADDON, *parts)) as handle:
            return handle.read()

    def test_the_label_has_one_home(self):
        core = self.source("Core", "CsScanList.js")
        self.assertIn('CsScanList.MARK_COMPLETE = "Mark Complete"', core,
                      "the menu wording lives with the list that draws "
                      "the tick")
        for folder, name in (("SketchScans", "SketchScans.js"),
                             ("SurveyNotebook", "SurveyNotebook.js")):
            panel = self.source(folder, name)
            self.assertIn(
                "CsScanList.markLabel", panel,
                "%s should take the mark menu's wording from Core "
                "rather than spelling its own" % name)

    def test_no_panel_spells_the_label_itself(self):
        for folder, name in (("SketchScans", "SketchScans.js"),
                             ("SurveyNotebook", "SurveyNotebook.js")):
            panel = self.source(folder, name)
            for wording in ('"Mark Complete"', '"Mark Incomplete"',
                            '"Finished with"'):
                self.assertNotIn(
                    wording, panel,
                    "%s spells %s itself -- use CsScanList.markLabel, "
                    "or the two panels will drift apart again"
                    % (name, wording))

    def test_both_panels_read_the_same_marks(self):
        """A page ticked while tracing is ticked while typing.

        Through CsScanList and not the setting directly. Each panel
        used to parse SETTING_BOOKMARKS itself, keep its own copy of
        the completed set, and write the WHOLE copy back on a toggle --
        so whichever panel ticked second undid the other's tick with a
        copy loaded before it happened. The store does the
        read-modify-write now, which is only true if neither panel can
        still write the setting behind its back.
        """
        for folder, name in (("SketchScans", "SketchScans.js"),
                             ("SurveyNotebook", "SurveyNotebook.js")):
            panel = self.source(folder, name)
            self.assertIn(
                "CsScanList.toggleComplete", panel,
                "%s should mark pages through the shared store" % name)
            self.assertIn(
                "CsScanList.loadComplete", panel,
                "%s should read the ticks from the shared store" % name)
            self.assertIn(
                "CsScanList.watch(", panel,
                "%s should repaint when the other panel marks a page"
                % name)
            self.assertNotIn(
                "CsScanTree.SETTING_BOOKMARKS", panel,
                "%s writes the marks setting itself -- that is the "
                "whole-set write the two panels drifted on" % name)


class TestScanBrowserIsShared(unittest.TestCase):
    """The tree and the page beside it are ONE widget, in Core.

    Both panels used to assemble the same pair by hand -- CsScanList's
    tree, CsScanView's preview, a zoom row under it -- and each chose
    its own geometry. So moving the tree beside the page in Sketch
    Scans left the Survey Notebook stacked, and the next change would
    have done the same again. The standing rule (Nathan, 2026-09-11) is
    that a change to this pair updates wherever it is used, and that is
    only structurally true while neither panel can build its own.
    """

    PANELS = (("SketchScans", "SketchScans.js"),
              ("SurveyNotebook", "SurveyNotebook.js"))

    def source(self, folder, name):
        with open(os.path.join(ADDON, folder, name)) as handle:
            return handle.read()

    def code(self, folder, name):
        """The file with its comments stripped -- a rule about what a
        panel CALLS must not be satisfied or broken by prose."""
        out = []
        for line in self.source(folder, name).splitlines():
            stripped = line.strip()
            if stripped.startswith("//") or stripped.startswith("*"):
                continue
            out.append(line)
        return "\n".join(out)

    def test_both_panels_build_the_browser_from_core(self):
        for folder, name in self.PANELS:
            self.assertIn(
                "CsScanBrowser.build(", self.code(folder, name),
                "%s should build the scans tree and preview through "
                "CsScanBrowser" % name)

    def test_neither_panel_assembles_the_pair_itself(self):
        for folder, name in self.PANELS:
            body = self.code(folder, name)
            for call in ("CsScanList.build(", "CsScanPreview.build("):
                self.assertNotIn(
                    call, body,
                    "%s calls %s itself -- that is the second copy of "
                    "the arrangement, and it is what drifted" %
                    (name, call))


class TestTeachingCave(unittest.TestCase):
    """The teaching cave replaced the invented Lesson Cave.

    Lesson Cave was generated, deterministic and made up, and it existed
    because of the suite's first rule: real cave entrances do not go in
    test data. That was the right answer for a FIXTURE and the wrong one
    for a CURRICULUM -- an invented cave closes perfectly because nobody
    walked it, and a student who learns on it has never met the thing
    the tools exist for. The rule is kept the other way now: the copy a
    student works on is sanitized.

    What is checked here is that the retirement was COMPLETE. A
    half-retired fixture is worse than either state: the generator still
    in the tree, quietly regenerating a cave nothing teaches from.
    """

    def test_the_lesson_cave_is_gone(self):
        left = [rel for rel in ("tools/make_lesson_cave.js",
                                "testdata/LessonCave.dat",
                                "testdata/LessonCave_MANIFEST.md")
                if os.path.exists(os.path.join(REPO, rel))]
        self.assertEqual(
            left, [],
            "the invented Lesson Cave was retired in favour of a real, "
            "sanitized teaching cave, but these are still in the tree: "
            "%s" % left)

    def test_the_sanitizer_has_one_home(self):
        """Two implementations of the suite's first rule is one that
        will be updated and one that will not.
        """
        with open(os.path.join(ADDON, "PackageCave",
                               "PackageCave.js")) as handle:
            packager = handle.read()
        self.assertIn(
            "CsSanitize.writeCopy", packager,
            "Package Cave should delegate to Core/CsSanitize.js rather "
            "than carrying its own copy of the sanitizer")
        self.assertTrue(
            os.path.isfile(os.path.join(ADDON, "Core", "CsSanitize.js")),
            "Core/CsSanitize.js is where the sanitizer lives")

    def test_the_teaching_copy_is_never_the_master(self):
        """CsTeach refuses to build a master FROM a teaching copy.

        Sanitizing a student's folder back into the master would
        enshrine whatever that student had done as the thing everyone
        resets to -- silently, and only noticed weeks later.
        """
        with open(os.path.join(ADDON, "Core", "CsTeach.js")) as handle:
            source = handle.read()
        self.assertIn("sourceIsTeaching", source,
                      "planMaster has to know whether its source is "
                      "already a teaching copy")
        self.assertIn("isTeaching", source,
                      "and CsTeach has to be able to tell")


# ---------------------------------------------------------------------
# The handbook.
#
# The pages are hand-written HTML, so nothing checks them but this: a
# tool that ships undocumented, a page that documents a tool nobody has
# any more, a link that points at no page, and an image nothing shows
# are all silent faults -- the handbook still opens, and the one page
# somebody needed is the one that is wrong.
# ---------------------------------------------------------------------

HANDBOOK = os.path.join(REPO, "docs", "handbook")


def handbook_index():
    with open(os.path.join(HANDBOOK, "index.json")) as handle:
        return json.load(handle)


class TestHandbook(unittest.TestCase):
    def setUp(self):
        self.index = handbook_index()
        self.pages = self.index["pages"]
        self.ids = [page["id"] for page in self.pages]

    def test_page_ids_are_unique(self):
        self.assertEqual(
            sorted(self.ids), sorted(set(self.ids)),
            "two pages share an id, so one of them is unreachable")

    def test_a_page_file_is_named_after_its_id(self):
        """Links are written as '<id>.html', so the two cannot differ."""
        for page in self.pages:
            with self.subTest(page=page["id"]):
                self.assertEqual(page["file"], page["id"] + ".html")

    def test_every_page_in_the_index_has_a_file(self):
        missing = [page["id"] for page in self.pages
                   if not os.path.exists(
                       os.path.join(HANDBOOK, "pages", page["file"]))]
        self.assertEqual(missing, [],
                         "these pages are indexed but not written: %s"
                         % missing)

    def test_every_page_file_is_in_the_index(self):
        """An unindexed page ships and is reachable from nowhere."""
        on_disk = sorted(name[:-5]
                         for name in os.listdir(
                             os.path.join(HANDBOOK, "pages"))
                         if name.endswith(".html"))
        orphans = [name for name in on_disk if name not in self.ids]
        self.assertEqual(orphans, [],
                         "these pages are in no index entry: %s" % orphans)

    def test_every_tool_has_a_page(self):
        documented = set()
        for page in self.pages:
            for tool in page.get("tools", []):
                documented.add(tool)
        missing = [name for name in tool_dirs() if name not in documented]
        self.assertEqual(
            missing, [],
            "these tools ship with no handbook page: %s -- write one "
            "under docs/handbook/pages/ and add it to index.json"
            % missing)

    def test_no_page_documents_a_tool_that_is_gone(self):
        tools = set(tool_dirs())
        stale = sorted(tool for page in self.pages
                       for tool in page.get("tools", [])
                       if tool not in tools)
        self.assertEqual(stale, [],
                         "these pages document tools that no longer "
                         "exist: %s" % stale)

    def test_every_internal_link_resolves(self):
        """A rotted link is the one fault a reader cannot work around."""
        broken = []
        for page in self.pages:
            path = os.path.join(HANDBOOK, "pages", page["file"])
            with open(path) as handle:
                body = handle.read()
            for href in re.findall(r'href="([^"]+)"', body):
                if href.startswith("http:") or href.startswith("https:"):
                    continue
                target = href.split("#")[0]
                if not target.endswith(".html"):
                    broken.append((page["id"], href))
                    continue
                if target[:-5] not in self.ids:
                    broken.append((page["id"], href))
        self.assertEqual(broken, [],
                         "these links point at no page: %s" % broken)

    def test_every_image_used_is_shipped(self):
        missing = []
        for page in self.pages:
            path = os.path.join(HANDBOOK, "pages", page["file"])
            with open(path) as handle:
                body = handle.read()
            for src in re.findall(r'<img[^>]+src="([^"]+)"', body):
                if not os.path.exists(
                        os.path.join(HANDBOOK, "images", src)):
                    missing.append((page["id"], src))
        self.assertEqual(missing, [],
                         "these pages show images that are not in "
                         "docs/handbook/images: %s" % missing)

    def test_every_shipped_image_is_used_or_indexed(self):
        used = set()
        for page in self.pages:
            for shot in page.get("shots", []):
                used.add(shot["image"])
            path = os.path.join(HANDBOOK, "pages", page["file"])
            with open(path) as handle:
                for src in re.findall(r'<img[^>]+src="([^"]+)"',
                                      handle.read()):
                    used.add(src)
        images = os.path.join(HANDBOOK, "images")
        orphans = sorted(name for name in os.listdir(images)
                         if not name.startswith(".") and name not in used)
        self.assertEqual(orphans, [],
                         "these images ship and nothing shows them: %s"
                         % orphans)

    def test_a_tool_page_says_when_you_reach_for_it(self):
        """The skeleton every page shares, checked where it matters.

        A page that only says what a tool IS leaves the beginner's
        actual question -- when would I use this -- unanswered, which
        is the failure the handbook exists to fix.
        """
        thin = []
        for page in self.pages:
            if page.get("class") != "tool":
                continue
            path = os.path.join(HANDBOOK, "pages", page["file"])
            with open(path) as handle:
                body = handle.read()
            if "<h1>" not in body or "When you reach for it" not in body:
                thin.append(page["id"])
        self.assertEqual(thin, [],
                         "these tool pages are missing an <h1> or a "
                         "'When you reach for it' section: %s" % thin)

    def test_the_shot_manifest_names_files_that_exist(self):
        """A screenshot's record of what it depicts has to be real, or
        the staleness check silently passes forever."""
        bad = []
        for page in self.pages:
            for shot in page.get("shots", []):
                if not os.path.exists(
                        os.path.join(HANDBOOK, "images", shot["image"])):
                    bad.append((page["id"], shot["image"]))
                elif not os.path.exists(
                        os.path.join(REPO, shot["depicts"])):
                    bad.append((page["id"], shot["depicts"]))
        self.assertEqual(bad, [],
                         "these screenshot records point at nothing: %s"
                         % bad)

    def test_no_screenshot_is_stale(self):
        """A shot records the tool file it depicts and that file's hash.

        PUBLISH ONLY, deliberately. A panel changes far more often than
        its screenshot needs retaking, and a check that blocked every
        edit until somebody reopened CaveCAD would be switched off
        within a week. A release is the moment the pictures have to be
        honest, so that is where this bites.

        It never recaptures: what state a panel should be photographed
        in is a decision, not a fixture.
        """
        if not PUBLISH_CHECK:
            self.skipTest("publish-only: a shot goes stale between releases")
        if os.environ.get("CAVESURVEY_SKIP_STALE_SHOTS") == "1":
            self.skipTest("automatic build: reported as a warning, never a failure")
        stale = []
        for page in self.pages:
            for shot in page.get("shots", []):
                path = os.path.join(REPO, shot["depicts"])
                with open(path, "rb") as handle:
                    now = hashlib.sha256(handle.read()).hexdigest()
                if now != shot["hash"]:
                    stale.append("%s (%s)" % (page["id"], shot["image"]))
        self.assertEqual(
            stale, [],
            "these screenshots were taken of a panel that has changed "
            "since: %s -- retake them through the MCP bridge, or say "
            "in the commit why the picture is still true and update "
            "the hash" % stale)

    def test_the_handbook_ships_inside_the_addon(self):
        """Only meaningful against a staged package: in the repo the
        add-on folder holds the tool and the pages live in docs/."""
        if ADDON == os.path.join(REPO, "scripts", "CaveSurvey"):
            self.skipTest("repo tree: the pages are read from docs/handbook")
        index = os.path.join(ADDON, "Handbook", "index.json")
        self.assertTrue(
            os.path.exists(index),
            "the staged package has no CaveSurvey/Handbook/index.json, "
            "so an installed CaveCAD would say the handbook is not "
            "installed -- check tools/make_package.sh")


if __name__ == "__main__":
    unittest.main(verbosity=2)
