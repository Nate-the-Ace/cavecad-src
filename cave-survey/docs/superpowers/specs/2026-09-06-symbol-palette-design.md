# Symbol Palette — design

Date: 2026-09-06
Status: approved design, not yet planned

## What this is

A docked palette of the cave feature blocks, grouped by category, that
places a symbol where you click; plus a symbol editor that lets a caver
draw a new symbol, give it a category and a home layer, and have it
join the palette permanently.

Today the suite already knows its symbols — `Core/CsSymbols.js` carries
28 `SYM_*` entries with an NSS name, a UIS alias, a home layer and a
category, and `CsSymbols.insert()` places one. But only ScatterBreakdown
and BuildLegend ever call it, and neither lets a caver pick a symbol. A
map's whole feature vocabulary is reachable only by scattering breakdown
or by printing a legend. This tool is the missing front door.

## Decisions taken (Nathan, 2026-09-06)

1. **Custom symbols are written into the template DXF.** Not a per-user
   library, not a per-cave folder. `NSS_Cave_Template_PLAN.dxf` in the
   Cave templates folder gains the new block, so every drawing started
   from the template afterwards carries it.
2. **An upgrade may lose them, and that is accepted.** `publish.sh`
   copies `templates/` into the Cave folder on every release, so a
   release overwrites a customised template. Nathan chose to accept the
   loss rather than build merge logic. (A one-line mitigation exists —
   have publish.sh move an existing template aside to
   `NSS_Cave_Template_PLAN.dxf.bak` before copying — and is worth taking
   if it stays that cheap, but it is not part of this design's contract.)
3. **Blocks import on demand.** A drawing that lacks the block gets the
   block definition copied in at placement time, so any drawing however
   old can use any palette symbol.
4. **The palette is a modeless dock panel with an icon grid**, in the
   shape SurveyNotebook / FeatureTrace / SketchScans already use.
5. **Previews are rendered from the block geometry**, not hand-drawn
   SVGs, so a custom symbol gets a preview for free and no preview can
   drift from the block it names.
6. **Placement: click to drop, click-and-drag to aim.** A press-release
   in place drops the symbol at the panel's current angle; press, drag
   and release rubber-bands the rotation and the release angle wins.
   Placement repeats until Escape.
7. **The symbol editor is a real drawing tab, and it can also edit an
   existing custom symbol.**
8. **A custom symbol's home layer is chosen from the existing registry**
   (`CsLayers.DEFAULTS`), never typed free-hand, so restyle, the profile
   and section twins and the layer palette keep working on it.
9. **Placement routes by location**, exactly as Feature Trace does since
   0.9.48.0: a symbol dropped inside a profile band or a section bay
   lands on that view's layer twin, and a section symbol carries the
   station its bay is a section of.

## Architecture (approach A)

One add-on tool folder, one new Core library. The panel never opens a
file; the store never builds a widget.

```
scripts/CaveSurvey/SymbolPalette/
    SymbolPalette.js        menu entry, dock panel, category groups,
                            icon grid, editor-mode fields
    SymbolPaletteRun.js     the placement action (press / drag / release)
    SymbolPaletteEdit.js    the symbol editor tab and its Save Symbol
    SymbolPalette.svg, SymbolPalette-inverse.svg
scripts/CaveSurvey/Core/
    CsSymbolStore.js        NEW — everything that touches the template
                            DXF and block definitions
    CsSymbols.js            EXTENDED — merged built-in + custom catalog
```

`Core/CsAll.js` gains the new file. (Engine trap: the test harness loads
Core by a hand-written list — a file missing from it passes silently
through the deliberate catches. `CsSymbolStore.js` must be added to that
list as well as to `CsAll.js`.)

Add-on wiring follows the fixed shape: QCAD's `AddOn.getAddOns` only
builds an add-on from `<dir>/<dir>.js`, so `SymbolPalette.js` must
`include()` its two siblings itself, and the dock must be BUILT during
`init()` and left hidden — the main window's `restoreState()` runs after
add-on init and can only place a dock that already exists. Every widget
construction and connect is wrapped so a bridge refusal costs one
control rather than the whole panel.

## Component: CsSymbolStore

The only code that opens a DXF or manipulates a block definition.
Everything is a pure function of a document plus a path; no widgets, no
module state beyond a cached template path.

- `templatePath()` — the same two-place lookup CaveTemplateApply uses:
  beside the add-on first, then `~/Documents/Cave/templates/`. Returns
  null with a plain-language reason when neither exists.
- `list(path)` — opens the template in an offscreen
  `RDocumentInterface` (the PackageCave / CaveTemplateApply pattern),
  returns every `SYM_*` block with the metadata read off its marker
  point (below). Cached per session; the editor invalidates it on save.
- `importBlock(doc, di, blockName)` — copies one block definition from
  the template into the open drawing when it is missing. Returns the
  block id, or null with a reason.
- `saveBlock(path, blockName, entities, meta)` — writes or replaces a
  block definition in the template, marker point included, and saves.
  Replacing an existing block is how symbol editing works.
- `geometryOf(path, blockName)` — the entities of a block, for the
  editor to load and for the preview renderer.

### Custom symbol metadata

This build cannot be relied on to persist custom properties on an
`RBlock`, so a custom symbol describes itself from inside: each custom
`SYM_*` block definition contains one invisible marker point on
`CTRL-HIDDEN` carrying XDATA via `CsTags`:

    SymbolNss       display name
    SymbolUis       UIS alias, may be empty
    SymbolCategory  palette group
    SymbolLayer     home layer, a registry name
    SymbolCustom    "1"

The block is therefore self-describing, and import-on-demand into an old
drawing carries the category and home layer along with the geometry.
There is no sidecar file to lose, and nothing to keep in sync.

The 28 built-ins keep their metadata in `CsSymbols.CATALOG` as today —
they are code, they ship with the tools, and they need no marker.
`CsSymbols.merged(doc)` returns the built-in catalog plus every custom
entry the store found, built-ins winning on a name collision.

## Component: the palette panel

A `QDockWidget` on the right, hidden at init, toggled from the Cave
Survey menu.

- One collapsible group per category, in `CsSymbols.categories()` order,
  with custom symbols appearing in whichever category they were given —
  a new category name creates a new group.
- Each entry is a toggle button showing a rendered preview and, on
  hover, its NSS name and UIS alias. Exactly one button is armed at a
  time; the armed button IS the indicator, as in Feature Trace.
- Scale and angle spinboxes. Angle is the default the drag overrides.
- A search box filtering across NSS name, UIS alias and block name.
- Buttons: **New Symbol…**, and **Edit** / **Delete** enabled only when
  the armed symbol is custom.

### Previews

Rendered once per symbol at panel build from `CsSymbolStore.geometryOf`:
walk the block's entities, take their bounding box, scale to fit a
square icon with a small margin, paint each line/arc/polyline/hatch into
a `QPixmap` in the palette's foreground colour. A block whose geometry
cannot be read gets a placeholder icon with its name, not a missing
button.

## Component: the placement action

`SymbolPaletteRun` is an `EAction` in the ShapedLinesRun / FeatureTraceRun
shape, using `mousePressEvent` / `mouseMoveEvent` / `mouseReleaseEvent`.

- **Press** records the anchor point (snapped) and starts a preview.
- **Move while pressed** rubber-bands the symbol at the anchor, rotated
  to face the cursor, once the cursor is more than a few pixels from the
  anchor. Under that threshold the panel's angle stands, so a plain
  click is a plain click.
- **Release** commits one block reference at the anchor, at the panel's
  scale, at the drag angle if there was a drag and the panel angle if
  not. The action stays armed for the next placement; Escape ends it.

Layer routing reuses the existing machinery rather than restating it:

    frame = CsProfileBox.frameAt(doc, region, point, bays)
    layer = CsLayers.twinFor(entry.layer, frame)
    layer = CsLayerVariants.nameFor(layer, run)  // profile bands only

with the profile run read from the band box under the point. A symbol
dropped in a section bay is stamped with `SectionTraceStation` and the
bay tag the same way a section trace is, so a captured section keeps the
provenance of its symbols.

`CsSymbols.insert()` gains an optional layer override so the caller can
hand it the routed layer; without one it behaves exactly as today. When
the block is missing, the action calls `CsSymbolStore.importBlock` and
retries once before reporting.

Refusals are reported in the same voice as Feature Trace's
`refusalReason`: a locked or frozen target layer silently swallows adds
in this build, so the state is read back and named.

## Component: the symbol editor

**New Symbol…** opens a new drawing tab from a small editor template
carrying an origin crosshair, a nominal-size reference circle at the
catalogue's default scale, and nothing else. The palette panel switches
to editor mode: fields for name, UIS alias, category (a combo of
existing categories, editable for a new one) and home layer (a combo
built from `CsLayers.DEFAULTS`, plan-frame names only), plus **Save
Symbol** and **Cancel**.

**Save Symbol** takes every entity in the editor tab except the
crosshair and the reference circle, and hands them to
`CsSymbolStore.saveBlock` with the metadata. Block name is derived from
the display name (upper-cased, non-alphanumerics to underscore, `SYM_`
prefixed) and checked for collision. On success the store cache is
invalidated, the palette rebuilds, the editor tab closes, and the new
symbol is armed.

**Edit** on a custom symbol opens the same editor pre-loaded with
`geometryOf` and the existing metadata; saving replaces the block in the
template. Instances already placed in the OPEN drawing are redefined by
the block replacement; instances in other saved drawings are not, and
the dialog says so before saving rather than after.

**Delete** removes the block from the template after confirming, and
warns that drawings already using it keep their own copies.

Built-in symbols cannot be edited or deleted. Editing one would put a
divergent block in the template under a name the shipped catalogue also
claims, and the next release would silently take it back.

## Errors

Every failure names the thing that failed and what the caver can do:

- template not found — both searched paths listed
- template not writable — path and permission stated, nothing half-saved
- block missing and import failed — symbol named, drawing untouched
- target layer locked or frozen — layer named and which of the two
- editor saved with no geometry — refused, editor stays open
- duplicate symbol name — refused, existing symbol named

## Testing

Headless unit tests (`tests/js_unit.js`) for the pure parts:
`CsSymbols.merged` collision and ordering, block-name derivation,
metadata round trip through marker tags, and the routing decision given
a synthetic frame.

A headless run test in the `scatter_breakdown_run.js` shape: open a
drawing without the symbol blocks, place one through the store's import
path, save, reopen, and assert the block reference is on the right layer
with the right block. Then a second placement inside a synthetic profile
band box asserting the profile twin layer, and one inside a section bay
asserting the station stamp.

Template-side: a test asserting every block named in `CsSymbols.CATALOG`
exists in the shipped template, which would have caught a catalogue
entry with no block behind it.

GUI parts — the dock, the previews, the drag-to-aim, the editor tab —
need a live dry run in CaveCAD; the bridge trap list applies (wrapper-only
widgets, method-vs-property, self-confirming message boxes).

## Out of scope

- Symbol libraries shared between cavers, or exported with a cave
- Symbol scaling that follows sheet scale automatically
- Replacing ScatterBreakdown's own placement path
- Any change to how the built-in 28 are drawn

---

## As built (2026-09-06, `5797556`)

Built as designed except where noted. Everything below is a deliberate
divergence, not drift.

**The editor's metadata fields are a dialog, not panel fields.** The
design put name, category and home layer into the panel while it was in
editor mode. They are a modal dialog raised by **Save Symbol** instead,
and the panel's editor mode is two buttons and a line of text, both
built at panel construction and hidden until needed. The reason is the
bridge: widgets constructed while a panel is already live are the least
reliable thing this add-on does, and this tool could not be dry-run in
front of a person before shipping. A Save button that failed to
construct would strand a caver with a drawing and no way to keep it. The
fields ask the same four questions in the same order.

**Custom symbols may still take a category of their own.** The category
combo is editable, so a caver can type a category the catalogue has
never seen and it becomes a group in the panel. The home layer combo is
NOT editable, per the design.

**The two section-bay tags moved into Core.** `FeatureTraceRun.BAY_TAG`
and `STATION_TAG` are now aliases of `CsTrace.SECTION_BAY_TAG` and
`SECTION_STATION_TAG`. Stamping a placed symbol with the tool file's own
constants would have made the palette depend on Feature Trace being
loaded -- which it is not, in the headless test that proves the stamp
happens.

**`publish.sh` now backs the live template up** into
`templates_previous/` before overwriting it, with a line on the console
saying so. The design recorded this as optional; a data-loss path that
is silent is worse than one that is loud, and it cost four lines.

### Engine truths found building this

Each measured against the real engine on 2026-09-06, each of which
produced a silent wrong result rather than an error:

1. **An entity carried into another document keeps its object id**, and
   `RTransaction` reads a set id as an edit to whatever that id names in
   the destination -- "original object not found in storage", and the
   copy lands nothing. `doc.getStorage().setObjectId(e, RObject.INVALID_ID)`
   clears it; it is what QCAD's own clipboard copy does in C++.
   `RObject::setId` is protected and not scriptable, and
   `cloneToEntity` is not exposed to script, so the storage call is the
   only route. `CsSymbolStore.adopt` is the one place it lives.
2. **`RAddObjectOperation(obj)`'s `useCurrentAttributes` defaults to
   TRUE**, and true means the drawing's current layer overwrites the
   layer the entity was given. Every routed symbol landed on layer 0
   while the tool cheerfully reported the layer it meant. Pass `false`.
3. **An add onto an off, frozen or locked layer is dropped silently.**
   The marker point's own home, `CTRL-HIDDEN`, is off in the registry,
   so every custom symbol saved without `withLayerOn` came back from the
   file anonymous -- geometry present, description gone. The save now
   also verifies the marker is there before writing the file.
4. **XDATA inside a block definition DOES survive a DXF round trip**
   through the dxflib exporter, which is what makes the self-describing
   block possible at all. It does not survive any other exporter, hence
   `CsSymbolStore.dxfFilter`.

### Known limitation, deliberately not fixed

A symbol placed in an elevation or a section has its block REFERENCE on
the view's twin layer, but the geometry inside the block still sits on
the plan feature layer (`FORMATIONS-DRIP` and friends) -- that is how
the shipped template's blocks are drawn. Two consequences: turning the
plan layer off hides the symbol in every view, and the symbol renders in
the plan layer's colour. The colour is a non-issue because a twin row is
a copy of its plan row, so the two match by construction. The visibility
coupling is real.

The fix would be to flatten every `SYM_*` block's geometry onto layer 0
with `ByBlock` colour, which is the standard symbol convention and would
make the reference's layer govern completely. It is NOT taken here
because Build Legend places its symbol references on the `LEGEND` layer:
flattening would make the whole legend render in one colour and lose the
per-feature colour that makes it readable. Fixing both means teaching
Build Legend to place each row on its own feature layer, which is a
change to a shipped output and belongs in its own piece of work.

### Verification

26/26 headless suites pass, including the new
`tests/symbol_palette_run.js` (the file round trip, import-on-demand,
plan/elevation/section routing, the station stamp, and the refusals) and
24 new assertions in `tests/js_unit.js`. Structural and publish checks
pass.

A live GUI check WAS then taken, through the MCP bridge against a
running CaveCAD (2026-09-06). What it confirmed: the dock builds at
startup with an empty `problems` list; 28 tiles in 8 groups; all 28
previews rendered from block geometry (`iconFor` returned an icon for
every one); **New Symbol...** opens a tab holding only the three
furniture entities and two layers, so the template pour really is
suppressed; a symbol drawn there saved into the live template, came back
in the palette with its category and home layer, armed, enabled Edit and
Delete, and deleted again cleanly; a shipped symbol leaves both buttons
disabled; and the placement action installs as the current action.

Two things the live check FOUND, both since fixed:

1. **The tiles were `QPushButton`s**, which lay icon and text side by
   side with no way to stack them -- so a 30px preview and the name
   shared one line and the name was cut to "Entran" and "Dom". They are
   `QToolButton`s with `ToolButtonTextUnderIcon` now.
2. **`instanceof` cannot identify a running action from the panel.**
   QCAD builds each action in its own script context and hands other
   contexts an `RActionAdapter`, so `current instanceof SymbolPaletteRun`
   is ALWAYS false -- which made the "do not restart the action that is
   running this very click" guard permanently inert. It compares the
   gui action's script file now. **Feature Trace's identical guard
   (`FeatureTraceRun`) is inert for the same reason and was left
   alone** -- it ships that way and changing it is its own piece of
   work with its own dry run.

What is STILL unproven, and needs a person: the actual mouse gestures.
Nothing here clicked or dragged in the drawing, so the click-to-drop /
press-drag-release-to-aim distinction, the cursor readout updating as
the mouse moves, and the modal Save Symbol dialog (a bridge must never
`exec()` one) have not been exercised. See
`docs/superpowers/plans/2026-09-06-outstanding-dry-runs.md`.


## Addendum: the drag sets size as well as angle (2026-09-06)

Nathan's request, after the first build: the drag should set the scale
too, not only the rotation.

**The distance dragged IS the symbol's radius.** Press where the symbol
goes, drag to where its edge should be, release. That definition is what
makes one gesture mean the same thing on a stalactite half a unit across
and a north arrow ten units across, and it makes the preview under the
cursor the answer rather than a hint about it. `CsSymbolStore.radiusOf`
supplies each symbol's own half-size -- from the open drawing when it
holds the block (a caver who redefined it means the shape in front of
them), otherwise from a radius map `list()` fills while it already has
the template open, because reopening a DXF per mouse gesture is not a
thing this tool may do.

`SymbolPaletteRun.scaleForDrag(distance, radius, panelScale, enabled)`
is the whole mapping and is pure. It falls back to the panel's Scale
field whenever the drag cannot mean anything -- sizing switched off, an
unknown radius, a drag of no length -- which is what keeps a plain click
a plain click. It is floored at 0.05 and capped at 500: the distance IS
the size, so a release a pixel from the press point would otherwise
place something too small to see or to find again.

**A drag writes its result into the panel's own Scale and Angle
fields.** Not a separate readout: the caver just set a size and an
angle, the two boxes that name size and angle should say what they got,
and the next plain click then places at exactly those numbers. A drag is
a way of typing in those fields with the mouse.

**`Drag sets size too` is a checkbox, on by default.** Off leaves the
drag aiming only, which is what a row of flow arrows that must all stay
one size needs.

### Verified live

Driven through the action's own press/move/release against a real
template drawing in a running CaveCAD: a plain click placed at the
panel's 1.0/0 deg; a 3-unit drag up-left on a 0.5-radius symbol placed
it at scale 6, 135 deg; the same drag with the box unticked placed at
scale 1, 135 deg. The panel's fields followed each drag.

**A note on how NOT to test this.** Synthesising a `QMouseEvent` in
script and pushing it in with `QCoreApplication.sendEvent` SIGSEGVs the
application inside the wrapper's `sendEvent` -- crashed CaveCAD once
here, with nothing of this add-on on the stack. Drive an action's own
handlers with a stub event object instead (`button()`, `buttons()`,
`modifiers()`, `getModelPosition()`); that exercises the same code
against the same document and cannot take the app down.


## Addendum: the size field is in feet (2026-09-06)

Reported: "I cannot see the blocks that are inserted."

They were being inserted. Measured in Truitt Cave through the live
bridge: the reference landed at the click point, on `FORMATIONS-DRIP`,
layer on and unfrozen, `isVisible()` true. It was 1 ft across in a cave
1270 ft across.

**The blocks are drawn about a foot wide.** A stalactite is 1 ft, a
breakdown boulder 1.1 ft, an entrance 2.4 ft, a north arrow 3.3 ft. So a
panel asking for a SCALE FACTOR was asking the wrong question twice
over: "1.0" told nobody what size they would get, and the same factor
was a different size on every symbol.

The field is a size in FEET of cave now, default 5, converted for a
metric drawing exactly as Feature Trace's interval is
(`CsTrace.spacingFor`), and divided by each symbol's own radius --
`scaleForSize(sizeFeet, radius, perFoot)`, pure and tested. One number
in the box, one size on the sheet, whichever tile is armed. The drag
still overrules it and writes its answer back in feet.

**Scatter Breakdown was left alone.** It places the same blocks at a
random 0.7-1.5 scale, which is the same 1 ft problem -- a scatter of
foot-wide boulders. Changing it changes a shipped output that judged
maps have been drawn with, so it is its own piece of work with its own
dry run, not a side effect of this fix.


## Addendum: the action's script context has no simple.js (2026-09-06)

Reported, with a screenshot: pits placed with the mouse never appeared,
and the command line read "Pit could not be placed: this drawing has no
SYM_PIT block" -- while `SYM_PIT` was in the drawing, one of 28.

`CsSymbols.insert` reached for the global `getDocumentInterface()`.
**That global comes from `scripts/simple.js`, which the application
loads into its own context. An interactive action is built in a
SEPARATE script context** (`RScriptHandlerJs::createActionDocumentLevel`)
whose includes are only what the action file itself pulls in -- and
`EAction.js` includes `library.js`, not `simple.js`. So `getDocument`,
`getDocumentInterface` and `warning` do not exist there. Every mouse
placement threw a TypeError inside `insert`, the caller's catch turned
it into the "no such block" sentence, and the caver went looking for a
block that was never missing.

Three changes:

1. `CsSymbols.insert` takes the document interface as a parameter.
   Callers in the application context may still omit it.
2. The palette reports a thrown error and a missing block as DIFFERENT
   things. A missing block is a drawing problem a caver can act on; a
   thrown error is a bug in this tool. Saying the first about the second
   is what made this cost a screenshot to find.
3. Every bare `warning()` in the palette becomes
   `EAction.handleUserWarning` -- another simple.js global, sitting in
   every error path in the panel.

### Why every test passed while this was broken

A headless test file defines `getDocument` and `getDocumentInterface`
itself, because it has no application to inherit them from -- so the
suite was, by construction, the one context where this bug could not
happen. `tests/symbol_palette_run.js` now deletes both and places a
symbol without them; verified to fail against the old code with exactly
the reported TypeError.

**The rule this leaves behind: code reached from an interactive action
may use only what `EAction.js` pulls in. A Core function that calls a
simple.js global works everywhere except where the mouse is.** Worth an
audit of the other Core functions the drawing tools call.


## Addendum: two dialog truths, and four other tools (2026-09-06)

Reported: Save Symbol did nothing, command line reading
`Function.prototype.connect: target is not a function`.

1. **`signal.connect(receiver, "slotName")` throws in this build.** The
   Qt Script idiom this suite used everywhere is not supported: the
   engine's connect takes a function, or a receiver plus a function, and
   never a string. It throws where the dialog is BUILT, so the tool dies
   before anything is shown.
2. **`widget.destroy()` throws too** -- "Invalid attempt to destroy() an
   indestructible object" -- for a parented dialog and an unparented one
   alike. It sat at the end of every dialog in the suite, AFTER the
   caver had answered, so the answer went out with the exception.
   `close()` then `deleteLater()` works; both are guarded anyway.

**This was never only the palette.** The same two lines were in Cross
Section, Callout, Repair Drawing and Surface Data. Every one of those
dialogs was dead in this build, and each is now fixed the same way.
Whether they broke in a CaveCAD/Qt upgrade or shipped that way is not
established here; what is established is that they throw today and do
not after this change.

Both forms are now pinned by structural tests
(`TestSignalsConnectToFunctions`, `TestNoWidgetDestroy`), because
neither is reachable headlessly -- they need a real QDialog and the
suite has no GUI. The guard was verified by reverting
`CrossSection.js` and watching the test name its two lines.

### The pattern behind all three GUI bugs in this tool

The palette's placement bug (simple.js globals absent in an action
context), the tile bug (QPushButton cannot stack icon over text), and
these two are one failure mode: **the JS bridge accepts the call and
then does not do what Qt would**. None can be caught by a headless
suite. The cheap defence is a structural test naming the forbidden form,
which is now the third one in `tests/test_addon.py`.


## Addendum: custom symbols now survive an upgrade (0.9.65.0)

Reported: "my mud slope symbol was created and added, but upon
reopening, it's gone from the palette."

**The design's accepted cost came due within the day.** On 2026-09-06
Nathan chose to keep custom symbols in the template and accept that a
release overwrites them; `publish.sh` deletes `templates/` wholesale
before copying the shipped file. On a development machine that runs
maybe fifteen times an evening, and one of those runs took a symbol that
had been drawn, named and saved twenty minutes earlier.

It was recoverable only because the same decision came with a backup:
`templates_previous/NSS_Cave_Template_PLAN-20260906-224143.dxf` still
held `SYM_MUD_SLOPE`, and the store read its name, category and layer
straight back out of the marker point inside the block -- which is
exactly the property the self-describing block was built for.

`tools/merge_custom_symbols.js` runs from `publish.sh` after the copy
now. Every `SYM_` block the shipped catalogue does not name is carried
from the outgoing template into the new one; the shipped 28 are never
carried, because they are code and the new file's copies are current.
The console says which symbols came across.

### The silent-layer trap, for the third time

`copyBlock` copied the geometry and left the marker behind, so a carried
symbol arrived anonymous -- the right picture under the wrong name, on
the wrong layer, in the "Custom" group. The cause is the one this suite
keeps meeting: **an add onto an off, frozen or locked layer is dropped
without a word**, and the marker lives on `CTRL-HIDDEN`, which the
registry keeps off. `saveBlock` already went through `withLayerOn` for
this reason; `copyBlock` did not.

It now adds through every layer the block uses, on and unlocked
(`CsSymbolStore.withLayersWritable`). Three separate functions in this
tool have now been bitten by the same rule. **Anything that writes an
entity in this suite should ask which layer it lands on first.**

Caught by the new test in `tests/symbol_palette_run.js` (3d), which
carries symbols between two real template files and then reads the
carried one's name, category and home layer back off disk -- not by
looking at it, which is how it would have shipped.


## Addendum: the symbols moved out of the template (0.9.66.0)

Nathan, after the mud slope was lost and recovered: "go ahead with that
then, I'm fine with it."

**Custom symbols now live in
`~/Documents/Cave/symbols/CaveCustomSymbols.dxf`.** Beside the caves,
because that folder is the one that syncs and gets backed up -- a symbol
drawn on one machine turns up on the next -- and because no installer,
release or template change touches it. This reverses the 2026-09-06
decision, and it reverses it for the reason the original decision was
made under: "a release overwrites them" was a rare event when it was
agreed, and is a fifteen-times-an-evening event on a machine that is
being developed on.

The shape of it:

- **Writes go to the library alone.** `saveBlock` with no path named
  creates the library if it does not exist and writes there. A test
  asserts the template is untouched afterwards, because that is the
  whole claim.
- **Reads take both files, the caver's own first.** `listAll` merges
  them into one palette, previews come from either, `ensureBlock`
  imports from whichever has the block, and Edit opens whichever holds
  it. A symbol in both is theirs.
- **Old symbols migrate when the palette opens.** Copy into the library,
  read back to prove it landed, and only then remove the template's
  copy. A migration that loses work is worse than one that never runs.
  It is a no-op every time after the first, which is what makes it safe
  to call on every rebuild.
- **publish.sh still carries custom blocks across a template swap.** It
  should now have nothing to carry. It stays as the net under a caver
  whose symbols predate this, not as the mechanism.

Verified live: the mud slope migrated out of the template into the
library, the palette shows 29 tiles with it under Floor and its picture
intact, three publishes in a row left the library byte-identical, and
the template is back to the shipped 28.
