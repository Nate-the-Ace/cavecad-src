# Layer Manager — design

Date: 2026-09-15
Repos: `cavecad-src` (the palette), `cavecad-tools` (Cave Survey starter groups)

## Problem

A cave drawing carries 152 registry layers from `CsLayers.js` before per-run
variants multiply them; a worked-up survey runs past 300. CaveCAD inherits
QCAD Community Edition's Layer List: a flat `QListWidget` with no tree, no
filter, and no way to say "show me only what I am tracing today". Finding a
layer means scrolling an alphabetical wall of `CTRL-SECTION-LRUD-WALL-LEFT`.

## Shape of the solution

A new palette, **Layer Manager**, living beside the stock Layer List rather
than replacing it. It offers three things the old list cannot:

1. **Arbitrary groups.** You make them, you name them, you file layers into
   them. A layer may belong to several. Nothing is derived or automatic.
2. **Filter search.** A text box that narrows the tree as you type.
3. **Layer states.** Named snapshots of every layer's off / frozen / locked
   flags, saved into the drawing and restored in one click.

The stock Layer List stays in the View menu, unmodified, so the flat view is
never more than one click away. Layer Manager's dock is visible by default;
Layer List's dock starts hidden, so two layer palettes do not stack on a
first launch.

## Why a fork of the palette and not a rewrite of it

Rewriting `scripts/Widgets/LayerList/LayerList.js` would put every future
QCAD upstream change to that file in conflict with ours, for a palette whose
behaviour we are changing wholesale anyway. A sibling folder diverges from
upstream by addition instead, and leaves a working fallback in place while
the new palette earns trust.

## File layout

All under `cavecad-src/scripts/Widgets/LayerManager/`. `scripts/AddOn.js`
discovers widget folders by scanning, so the folder needs no registration —
only a `LayerManager.init` function, per the suite's add-on wiring rule.

| File | Responsibility |
| --- | --- |
| `LayerGroups.js` | Group model. Read and write membership and the registry. Pure data plus document I/O; no widget code. |
| `LayerStates.js` | State model. Capture and restore named on/off/lock snapshots. Same split. |
| `RLayerTreeQt.js` | The `RTreeWidget` subclass: columns, icons, filter, selection, drag and drop, context menu. |
| `LayerManager.js` | `RGuiAction`, the dock, button wiring, preferences. |
| `LayerManager.ui` | Filter line edit, group buttons, state combo, button row. |
| `LayerManager.svg`, `LayerManager-inverse.svg` | Palette icon, light and dark. |

Each model file is independently testable and holds no Qt types, which is
what lets the unit tests below exist at all.

## No C++ is required

`RTreeWidget` (`src/gui/RTreeWidget.h`) already exists in core: a
`QTreeWidget` subclass that emits `itemColumnClicked(item, column)` and
`contextMenuRequested(item, column)`, and is `\scriptable`. `BlockList.js`
already drives it with per-column icons (`BlockList.colVisible`,
`BlockVisible0.svg` / `BlockVisible1.svg`) and its own context menu. Layer
Manager follows that precedent exactly, so the entire feature is JavaScript.

## Storage

Everything lives in **one document-level blob**, chunked across document
variables. That is a measurement, not a preference.

The design this spec originally called for put a layer's memberships on the
layer, in QCAD custom properties, so a deleted layer took its memberships
with it and no repair pass could ever be forgotten. It does not survive a
save. `RDxfExporter::writeLayer` (`RDxfExporter.cpp:630`) writes a layer's
name, flags, colour, lineweight and linetype and nothing else, so layer
XDATA never reaches the file. Measured 2026-09-16: exported a drawing with
two groups filed, re-imported it, and read the memberships back empty while
the document variables came through untouched. The alternative was teaching
the exporter and dxflib to carry layer XDATA — C++ in a 3rdparty vendor
library, a rebuild of both ninja trees, a re-sign, and a private DXF
extension no other CAD would read — against a JavaScript change that is
already proven to persist.

Stored shape, terse because it is written into a DXF:

```json
{"v":1,
 "l":["0","CTRL-SHOTS"],
 "g":[{"n":"Plan work","m":[1]}],
 "s":[{"n":"Plan only","c":"000110"}]}
```

`l` is a layer name table; groups reference it by index; a state is one
string of three characters per table entry (`---` where the state has no
entry for that layer). The table travels inside the same blob as the
indices that reference it, written and read in one go, so the two cannot
drift apart. A state of 300 layers costs 900 characters instead of the
~8 KB an explicit name-to-code map would.

Callers never see indices. In memory:

```js
{ groups: [ { name: "Plan work", members: ["CTRL-SHOTS"] } ],
  states: [ { name: "Plan only", flags: { "CTRL-SHOTS": "110" } } ] }
```

**The price is a sweep.** Membership is keyed by layer name, so a layer
renamed or deleted through QCAD's own layer list leaves its name behind.
`readRegistry` sweeps against the document's real layer names on every
read, so a stale entry never reaches the tree and there is no repair
command to forget to run. The sweep is not written back — a read is not the
place to modify a document, and stale names are invisible until the next
write drops them. Verified live: renaming a layer behind the palette's back
took it out of its group on the next refresh.

**Chunking is mandatory, not cautious.** `RDxfExporter` writes document
variables as XRecords into `QCAD_OBJECTS` (`RDxfExporter.cpp:409`) and
dxflib's reader dies at 1024 characters on one line, silently dropping the
rest of that section — the bug that made image xrefs vanish on save. This
blob holds every layer name a group or state mentions, so on a real cave it
is guaranteed to pass the limit. Chunks are capped at 800 characters. A
real drawing measured seven chunks.

**Group edits are not undoable.** Document variables are not transactional.
Filing a layer changes no geometry, and an undo of an unrelated drawing edit
that silently unfiled a layer would be the more surprising of the two
behaviours. The modified flag is set explicitly, so a drawing whose only
change was a renamed group still offers to save.

## Nesting

Groups nest **one level and no more**. A group may name a parent; the tree
draws it inside that parent, and a group whose parent is itself nested is
flattened to the top on read rather than drawn three deep. The cap is the
point: a layer palette is a place to find a switch, and arbitrary depth
turns it into a filing cabinet to get lost in.

Names stay globally unique, so a group is still addressed by its name
alone and nothing else in the model had to learn about paths. A parent row
answers for everything under it — its eye and lock act on the whole
subtree and its three-state icon is derived from it — via
`membersUnder`, and the tree walks its own rows rather than the registry
so that a row hidden by the filter is still toggled by its group.

Deleting a parent does not delete its children: they come back to the top
level. Losing a shelf should not lose what was on it, and the alternative
is a delete whose blast radius is invisible until it has happened.
Renaming a parent re-points them, or they would be flattened on the next
read and it would look as though the rename had moved them.

What this buys, in the Cave Survey scheme: eleven groups become **six top
level rows**, with the six plan families (Passage, Floor, Formations,
Water, Geology & Finds, Notes) inside one `Plan` parent that holds no
layers of its own and exists to be the single switch for everything drawn
in plan.

## The Ungrouped row

Renameable, through `ungroupedLabel` on the registry, and still not a
group: it takes exactly the layers in no group, is always last, and cannot
be deleted. Once a drawing is fully filed, "Ungrouped" is the wrong word
for whatever arrives afterwards, and the caver is better placed than this
palette to say what the right one is.

## The tree

Eight columns, in AutoCAD's Layer Properties Manager order, because that
is the table cavers already know: **Layer | On | Freeze | Lock | Plot |
Color | Linetype | Lineweight**.

Name first is forced, not stylistic. A tree draws its indentation and
expand arrow inside column 0: with an icon there, every child row's icon
was squeezed out of the 22px column and simply did not appear, while the
group rows at depth 0 drew theirs fine. Measured in the running GUI —
widening column 0 to 60px brought the missing icons back.

**On and Freeze are separate controls now.** The stock QCAD layer list
moves both together and the first cut of this palette copied it;
AutoCAD has given them a column each for thirty years, and a caver who
freezes a layer to speed up a regeneration means something different
from one who switches it off.

The four switches live in one `RLayerTreeQt.switches()` table — column,
getter, setter, icon set — so adding a fifth is one entry rather than
four edits in four places. Group rows roll their subtree up into
all-on / all-off / mixed, derived every refresh and never stored.

Colour shows a cached swatch beside its hex: a cave has a dozen distinct
layer colours and three hundred layers, and building a pixmap per row
per repaint is the difference between a palette that opens and one that
hesitates.

Eight columns do not fit a docked palette at its usual width, so
right-clicking the header offers one checkable entry per column and the
choice is remembered per user.

## Editing

Clicking a switch column toggles it. Clicking Color, Linetype or
Lineweight opens a picker seeded from the first layer in the selection,
so a uniform selection shows what it already is rather than a default.

**The selection wins when the clicked row is part of it.** Click a
switch on one of eight selected layers and all eight move; click one
outside the selection and only it moves. That is what every table in
every CAD program does, and the alternative — always acting on one row
— makes a multiple selection decorative. A selected group row
contributes every layer under it. The whole edit is one transaction, so
a change across forty layers is one undo.

A set is decided once rather than inverted row by row: if any member is
on, they all go off. Inverting each separately would turn a mixed
selection into a differently mixed one, which is never what the click
meant.

One consequence worth writing down: **the current layer changing no
longer rebuilds the tree.** The stock list rebuilds there, which is
harmless for a flat list and is not for this one — selecting a row would
throw away every other row the caver had selected, and editing across a
selection is the whole point of the table. It also destroys every
`QTreeWidgetItem` mid-click, which is how this was found.

## Filter

A `QLineEdit` above the tree, matching layer *and* group names, case
insensitively. Matching groups auto-expand; clearing restores the
collapse state that was in effect before typing.

**Wildcards when you type one, substring when you do not.** `*` is any
run of characters and `?` is exactly one, and a pattern is ANCHORED, so
`CTRL-*` means names that start that way. Plain text stays a substring
search, because a caver typing `scan` means "show me the scan layers"
and an anchored `scan` would match nothing and read as broken. Commas
separate alternatives: `CTRL-*,PROFILE-*` shows both.

This lives in its own file, `LayerFilter.js`, for one reason:
`RLayerTreeQt.js` subclasses `RTreeWidget` at load time and therefore
cannot be loaded without Qt, so nothing inside it can be unit tested. A
filter that quietly matches the wrong thing is a bug a caver blames
their layer names for, so it is the last thing that should be
untestable.

## Group management

Context menu on the tree, mirrored by buttons in the `.ui`:

- New Group
- Rename Group
- Delete Group — removes the group; members lose that one membership and
  fall to `Ungrouped` if it was their last. **Deleting a group never deletes
  a layer.**
- Add Selected Layers To ▸ (submenu of existing groups, plus New Group…)
- Remove From This Group

**No drag and drop.** The question was whether `dropEvent` could be
overridden from script; it cannot. `qcadjsapi`'s `rtreewidget_wrapper.cpp`
forwards exactly five virtuals — `contextMenuEvent`, `mousePressEvent`,
`mouseReleaseEvent`, `mouseMoveEvent`, `resizeEvent` — so a drop would
silently do nothing. The context menu carries the feature, as the fallback
said it would. (Checked first against `src/scripting/ecmaapi`, which is
vestigial upstream code that is not in the build graph; the live binding is
`qcadjsapi`.)

## Layer states

A combo box at the foot of the palette with Save, Update and Delete.

- **Save** captures off, frozen and locked for every layer in the document
  under a new name.
- **Update** overwrites the selected state from the current flags.
- **Restore** (selecting a state) applies the flags inside a single
  transaction, so one undo puts everything back.
- A layer created *after* a state was saved has no entry in it and is
  **left untouched** by a restore. The alternative — guessing a default —
  is how an elevation datum gets rebased to zero, and the suite has closed
  that door five times already.

## What a state remembers

Everything a layer is, not just whether you can see it:

```js
{ off, frozen, locked, plottable, snappable,
  color, linetype, lineweight }
```

**Every field is optional, and that is the design.** A field a record
does not carry is left alone on restore, exactly as a layer the state
never mentions is left alone. That is what lets the template ship a
`Plot ready` meaning "hide the scans" without it also meaning "and put
every colour back to the day the template was built" — a state that
froze the palette would quietly undo Restyle Layers every time anyone
applied it. A state a caver **saves** captures all of it, because they
asked for a photograph of the drawing as it stands.

Colour is stored as `#rrggbb` and not `RColor::getName()`, which answers
`White` for one colour and `#1163c8` for the next: a named colour is a
localised string in some builds, and a state written in one language
would not read back in another. Linetype travels as a **name**, because
the id a layer holds means nothing in another drawing — and a linetype
this drawing has never loaded is left alone rather than forced to
CONTINUOUS.

Restore no longer claims `LayerVisibilityStatusChange` on its
transaction. That type lets the view take the cheap regeneration path,
which was true when only on/off/lock could move and is a lie now that a
state can change colour, linetype and lineweight — the drawing would
keep the old appearance until something else forced a redraw.

Stored as one packed string per layer, `flags;colour;linetype;weight`,
in an array aligned to the layer-name table — variable length, so the
array is what carries position where version 1 used a fixed three
characters per entry. Version 1 blobs and version 1 `.clas` files are
still read: a three-character entry becomes a flags-only record, which
is exactly what it meant.

## Carrying states between drawings: `.clas`

A state names every layer in the drawing it was saved from, so it is the
one part of the arrangement a template cannot carry: the groups are a
rule, a state is a photograph. Export writes them to a file; import
merges them into another drawing.

**`.clas` is CaveCAD's own and is not AutoCAD's `.las`.** It fills the
same role — named layer states in a file you can hand to somebody — and
that is the whole of the relationship. AutoCAD's is an INI-shaped list of
layer properties; this is JSON, carries only the three flags a state here
holds, and neither program reads the other's. The distinct extension is
the point: a file that will not open should say so by its name rather
than by an error halfway through.

The file keys flags by **layer name**, not by the positional table the
drawing stores. A person may open and edit this file, and a positional
format would make one innocent edit shift every flag after it.

```json
{ "format": "cavecad-layer-states", "version": 1,
  "origin": "Truitt Cave.dxf",
  "states": [ { "name": "Tracing", "flags": { "BORDER": "110" } } ] }
```

Import rules, each chosen so a surprise is impossible rather than
unlikely:

- **Merged, never wholesale.** A state already here under the same name
  is replaced; everything else is untouched. Importing what you just
  exported is a no-op, not a way to end up with two `Tracing`s.
- **A layer this drawing does not have is dropped, and counted.** The
  sweep would drop it on the next read anyway; importing one cave's
  states into another is a legitimate thing to do, and a silent partial
  result would not be.
- **A state with nothing in common is skipped**, not imported empty — an
  empty state looks like one that does nothing.
- A file from a newer version is refused rather than half-read; a
  malformed flag is dropped rather than stored, so it can never reach
  `applyCode`.

Export takes every state rather than the selected one: states are cheap
to carry and someone exporting `Tracing` almost always wants `Plot ready`
too. The choosing happens at import, and does not need to, because a
state that does not apply is dropped there.

The UI is one `⋯` button in the state row, holding Rename, Export and
Import — four buttons wide is the row's budget. Its `popupMode` is set
numerically: the `QToolButton.InstantPopup` enum name is unbound in this
build and reads as `undefined`, which silently sets press-and-hold.

## Cave Survey side

**Group Layers** (`gl`), in `cavecad-tools`, with the classifier in
`Core/CsLayerGroups.js`. Six groups, not the seven first sketched: Plan,
Profile, Sections, Survey control, Scans & basemap, Sheet.

Notes lost their group. `PROFILE-NOTES-DIG` belongs with the profile a
caver is working on, not in a pile of notes from three views, and a "Notes"
group that held only plan notes would have been a worse answer than none.
The classifier reuses `CsLayers.frameOf` rather than re-deriving the frame,
with two rules on top: `CTRL-` beats the frame (the survey skeleton goes
off in all three views at once), and scans and basemap beat `CTRL-` (they
are tracing sources, not control, and several of them carry the prefix).

It only ever adds. Re-running picks up layers created since — per-run
variants land with their base for free, because a variant's token goes last
and its prefix still reads — and leaves every hand-made group and every
hand-filed layer alone. There is no reset to defaults: the groups are the
caver's the moment it has run once.

It refuses a sheet, like every other tool in the suite that writes, and
says so plainly when the build has no Layer Manager to store groups in.

The fork itself stays generic; nothing in `scripts/Widgets/LayerManager/`
knows the word "cave".

## Testing

`cavecad-src` has no JavaScript test harness, and this design does not add
one. `LayerGroups.js` and `LayerStates.js` hold no Qt types, so they are
tested from `cavecad-tools/tests/js_unit.js`, which already loads engine
files by explicit path.

That harness has a known trap: it loads Core by a hand-written list inside
deliberate catches, so a file that fails to load passes silently. The
Layer Manager tests therefore begin with an assertion that the fork files
actually loaded — a named function must exist — before any behaviour is
asserted.

Covered by unit tests:

- Membership: file, re-file, unfile, and a layer in two groups at once.
- An emptied group still exists; renaming onto an existing group merges.
- The sweep drops a layer the document no longer has, from groups and from
  every state.
- Round trip through the stored form, including an empty group, and the
  shape of that form: a code string is exactly three characters per table
  entry.
- Chunking at real scale — 300 layers and a full state — reassembles
  identically, no chunk exceeds 800 characters, and shrinking the registry
  removes the chunks it no longer needs.
- A truncated blob reads as empty rather than throwing; an out-of-range
  member index is discarded rather than resolved.
- Flag codes: encode, apply, and applying a state a layer already matches.
- `LayerStates.apply` is still `Function.prototype.apply` — asserted so
  that renaming `applyCode` back fails here rather than in the GUI.
- `CsLayerGroups.classify` on every layer in the registry, including the
  order-dependent cases: scans beat `CTRL-`, `CTRL-` beats the frame, and
  the section cut mark stays with the plan.

Tree, filter and drag behaviour are verified live in a running CaveCAD
through the `cavecad` MCP bridge. Per the live-restart trap, each check
follows a confirmed clean restart — a quit blocked by unsaved changes leaves
the old add-on running and makes "verified live" mean verified against stale
code.

## Deferred

- Groups derived automatically from the `-` prefix hierarchy. The names
  support it, but explicit groups were the ask and two organizing systems in
  one palette is a worse panel.
- Per-group colour or linetype overrides.
- Sharing groups between drawings.
