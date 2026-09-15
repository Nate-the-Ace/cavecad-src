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

Membership and per-state flags live **on the layer object**, in QCAD custom
properties (`RObject::setCustomProperty`, already used by `BlockList` for
`QCAD`/`ResourceFlag`, so the mechanism is proven to round-trip).

```
layer.setCustomProperty("CaveCAD", "Groups", "Plan work|Trip 3 edits")
layer.setCustomProperty("CaveCAD", "State:Plan only", "010")   // off, frozen, locked
```

Consequences, all of them wanted:

- Deleting a layer deletes its memberships and its state entries with it.
  There is no orphan sweep to write and none to forget to run.
- Renaming a layer keeps them, because it is the same `RLayer` object.
- Group and state names may not contain `|`. The New/Rename dialogs reject it.

The document registry holds only what a layer cannot: the ordered list of
group names (so an emptied group survives), the ordered list of state names,
and per-group collapsed flags. It is serialized to JSON and written to
document variables **chunked into pieces of at most 800 characters**
(`CaveCADLayerManager0..N`, plus a count variable).

The chunking is not caution for its own sake. `RDxfExporter` writes document
variables as XRecords into the `QCAD_OBJECTS` section (`RDxfExporter.cpp:409`),
and a single DXF line longer than 1023 characters desynchronises dxflib and
silently drops the remainder of that very section — the bug that made image xrefs vanish on save. Group names are
user-typed text of unbounded length, so the registry is exactly the kind of
value that would reach that limit and fail quietly.

## The tree

Three columns: **name | eye | lock**.

This replaces the stock list's single 32×16 composite icon and its
`x < iconSize/2` hit test. `itemColumnClicked` reports the column directly,
so the hit test disappears rather than being ported.

- Top level is your groups, in registry order, then `Ungrouped` last.
- `Ungrouped` holds every layer with no membership. It cannot be renamed or
  deleted and is not present in the registry.
- A layer in two groups appears under both. Toggling either instance changes
  the one layer; the refresh redraws every instance.
- Group rows carry their own eye and lock, acting on all members. Their
  drawn state is **derived** from the members every refresh — all on, all
  off, or mixed. No group visibility is stored, so there is no way to reach
  a state where the group says off and a member says on.
- Selection is extended: multiple layers may be selected for group
  operations. The current layer follows the first selected item, as today.
- Double-click keeps the stock behaviour: move selection to layer if
  something is selected, otherwise edit the layer.

## Filter

A `QLineEdit` above the tree, with a clear button and placeholder text.
Case-insensitive substring match against layer names and group names.

- A layer matches: it shows, and its parent groups show.
- A group name matches: the group and all its members show.
- A group with no visible children hides.
- While a filter is active, matching groups auto-expand. Clearing the filter
  restores the collapse state that was in effect before typing, rather than
  leaving every group open.

## Group management

Context menu on the tree, mirrored by buttons in the `.ui`:

- New Group
- Rename Group
- Delete Group — removes the group; members lose that one membership and
  fall to `Ungrouped` if it was their last. **Deleting a group never deletes
  a layer.**
- Add Selected Layers To ▸ (submenu of existing groups, plus New Group…)
- Remove From This Group

Dragging selected layers onto a group row files them there. This is a
convenience, not the mechanism: it is unclear whether `dropEvent` can be
overridden through QCAD's JS bindings, and that question is answered during
implementation rather than assumed. If it cannot, drag and drop is dropped
and the context menu carries the feature unchanged — no redesign follows.

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

## Cave Survey side

A tool in `cavecad-tools` that builds starter groups from the `CsLayers`
registry: Plan, Profile, Section, Notes, Control, Scans & Basemap. It ships
through `publish.sh` like every other Cave Survey change.

It is idempotent — re-running it refiles the registry layers and leaves any
group you made by hand alone. The fork itself stays generic; nothing in
`scripts/Widgets/LayerManager/` knows the word "cave".

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

- Membership round-trips: set, read, add a second group, remove one.
- Registry survives a group being emptied.
- Chunking: a registry long enough to need several chunks reassembles
  identically, and no chunk exceeds 800 characters.
- Group names containing `|` are rejected.
- State capture and restore, including a layer absent from the state.

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
