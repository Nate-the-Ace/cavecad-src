# The Handbook — design

A documentation site that lives inside CaveCAD. Every tool, every
procedure, every piece of vocabulary, explained with worked examples on
a real cave, reachable without a web browser and without a network.

Decided 2026-09-13.

## Why

The suite has 27 tools and no explanation of any of them outside the
README, which a student never opens, and the status tips, which are one
sentence each. The classroom question — "what do I press, and why" — has
no answer inside the application it is asked in.

This also settles the two deliverables the teachable-consolidation plan
still owes. The six-lesson curriculum (`docs/LESSONS.md`, task 10) is
absorbed: the lessons become process pages here, so the prose is written
once and read where the drawing is. `docs/LESSONS.md` is dropped as a
separate artefact. Start Here (task 11) stays a separate future tool,
and when it is built it walks these same pages rather than carrying
copies of them.

## Decisions

| Question | Answer |
| --- | --- |
| Where it appears | Dock panel beside the drawing |
| Panel layout | Drill-down: one pane at a time (layout B) |
| Where content lives | Hand-authored HTML under `docs/handbook/` |
| Examples | Screenshots of the real panels, plus a worked example on Truitt Cave |
| Screenshot staleness | A manifest and a test that flags stale shots; recapture stays manual |
| How it is reached | A `?` button on every panel, AND a menu entry |
| The curriculum | Absorbed as process pages |

The `?` button alone was the first choice; the menu entry was added
because a student with no panel open would otherwise have no door, and
because the modal tools (Repair Drawing, Callout, Surface Data, Package
Cave, Teaching Cave, Reset Drawing) have no panel corner to put a `?`
in.

## Architecture

### The content store

```
docs/handbook/
  index.json          the page list and the screenshot manifest
  pages/*.html        one file per page
  images/*.png        screenshots and diagrams
```

Pages are the Qt rich-text subset that `QTextBrowser` understands:
headings, paragraphs, lists, tables, `<img>`, anchors, inline CSS. No
JavaScript, no external references, nothing to fetch. `setSource()`
gives link following and Back/Forward for free, and resolves `<img
src="../images/x.png">` relative to the page — which is why images sit
beside pages rather than being embedded.

`QTextBrowser` is known to work in this bridge: CheckMap already builds
one (`CheckMap/CheckMap.js:92`).

### Packaging and path resolution

The handbook ships inside the add-on, the way the templates already do:
`tools/make_package.sh` copies `docs/handbook/` to
`CaveSurvey/Handbook/` in the staged package.

`CsHandbook.rootPath()` uses the three-candidate pattern
`CsSymbolStore.templatePath()` established, in the same order and for
the same reasons:

1. `includeBasePath + "/../Handbook"` — the copy inside a build
2. the `CaveSurvey/HandbookPath` setting, for a moved copy
3. the repo checkout's `docs/handbook`, resolved from
   `RSettings.getOriginalArguments()`, so a dev tree works unbuilt

First candidate that exists wins. None existing is not a crash: the
panel says the handbook is not installed and names the paths it looked
in.

### `Core/CsHandbook.js`

Pure lookup over the index. No document, no widget — the same contract
as `CsHelp`.

| Call | Answers |
| --- | --- |
| `CsHandbook.index()` | the parsed index, read once and cached |
| `CsHandbook.page(id)` | one page record, or null |
| `CsHandbook.forTool(name)` | the page id documenting that tool folder, or null |
| `CsHandbook.next(id)` | the page after this one in reading order, or null |
| `CsHandbook.search(text)` | page ids whose title or body contains it, title hits first |
| `CsHandbook.filePath(id)` | the absolute path `setSource` is given |

Search reads the page files once on first use and holds a lowercased
body string per page. At ~62 short pages this is small enough that an
index is not worth building.

### `index.json`

```json
{
  "pages": [
    {
      "id": "feature-trace",
      "title": "Feature Trace",
      "class": "tool",
      "stage": 452,
      "tools": ["FeatureTrace"],
      "file": "feature-trace.html",
      "shots": [
        { "image": "feature-trace-panel.png",
          "depicts": "scripts/CaveSurvey/FeatureTrace/FeatureTrace.js",
          "hash": "<sha256 at capture>" }
      ]
    }
  ]
}
```

`class` is one of `tool`, `task`, `concept`, `process`. Reading order
is the order of the array; `stage` places tool pages under the menu
stage they belong to, so the contents view and the Cave Survey menu
have the same shape.

### The panel — layout B, drill-down

`Handbook/Handbook.js`, a dock widget built at init and hidden, exactly
as CheckMap's is, for the same reason: `restoreState()` can only place a
dock that already exists.

One pane at a time, top to bottom:

- **Title bar**: back arrow, breadcrumb (`Draw the map › Feature trace`).
- **Body**: the `QTextBrowser`, taking all remaining height.
- **Foot**: `Contents` and a search field.

`Contents` swaps the body for the contents list — stages with their tool
pages, then tasks, concepts and processes — and the back arrow returns
to the page. Every page ends with a `Next:` link, so the whole handbook
reads front to back as a course; this is the one idea taken from the
layout-C mockup.

Back/Forward is `QTextBrowser`'s own history, so a link followed inside
a page unwinds the same way the breadcrumb arrow does.

### Reaching a page

**Menu entry.** `Handbook` at `groupSortOrder` 450, `sortOrder` 10 — the
empty first slot in the Start here stage, so it is the first thing in
the menu. Commands `handbook`, `hb`. `setRequiresDocument(false)`: the
handbook opens with no drawing, which is the state a student who has
just installed CaveCAD is actually in.

**The `?` button.** One helper, `CsPanel.helpButton(panelName)`, returns
a small flat `?` for a panel header; pressing it opens the dock at
`CsHandbook.forTool(panelName)`. It lives in `CsPanel.js` because a
panel feature written twice drifts — the same rule that put the fold
headers and the scan browser there. Panels that get one: Draw, Feature
Trace, Symbol Palette, Sketch Scans, Survey Notebook, Check Map, Sheet
Setup, Cross Section, Caves, 3D View, Handbook itself (it opens its own
"how to read this handbook" page).

A tool with no `?` — the modal ones — is reached from the menu or from
its stage in the contents.

## The pages

~62, in four classes.

**27 tool pages**, one per tool folder, no exceptions. These are
reference, not tutorial: what the tool is, when you reach for it, what
its controls do, and what its refusals mean. The teaching lives in the
task pages, so a tool page stays short.

**21 task pages** — the "how do I…" recipes, each crossing several
tools. The list, grouped:

*Scans and reference*: line a scan up under the drawing · put a scan
back when its file moved · trim a scan to the sketch · lay sketches on
the passage in 3D · put aerial imagery and contours under the cave.

*Survey data*: add a trip to a cave you already have · correct a bad
reading without forking a duplicate trip · bring in a Compass, Walls,
Survex, Therion or CSV survey · write the survey back out · set the
cave's location, and what the elevation datum will do to you.

*Drawing*: trace one wall across several passes so it stays one line ·
draw a ledge or pit so the hachures face the right way · fill the floor
with a pattern · capture a cross section, three routes · rebuild the
extended elevation.

*Finishing*: put a sheet together at a scale that fits the paper · make
the legend say what the map uses · work Check Map's list down to
nothing · see where a loop error actually happened.

*Sharing*: hand a cave to someone else, sanitized or full · set a
student up on the teaching cave and reset it after.

Gaps in this list are expected and are found by use, not by more
planning. A new task page is one HTML file and one index entry.

**8 concept pages**: stations, shots and LRUD · layers, and what colour,
weight and linetype each say · the elevation datum · trips and revisions
· where a cave's files live · the privacy rule · symbol conventions
(links into `CsHelp`, never restates it) · loop closure and adjustment.

**6 process pages**, the absorbed curriculum: your first cave map ·
typing a trip into the notebook · drawing walls over a scan · sections
and profile · reading the map for faults · sharing it.

### The shape of a page

Every page, same skeleton, so the shape is learned once:

1. Title and one sentence saying what it is.
2. **When you reach for it** — the situation, not the feature.
3. A screenshot of the real panel.
4. **Steps**, numbered and imperative.
5. **Try it on Truitt** — a named thing to do in the teaching cave.
6. **When it refuses** — the tool's real messages and what to do about
   them. These already exist in the tool source and are quoted, not
   paraphrased, so a student can match what is on their screen.
7. **See also**, then **Next:**.

Sections 5 and 6 are omitted on a page that has nothing true to put in
them. Nothing else may be.

## Screenshots

Each shot records the tool source file it depicts and that file's SHA-256
at the time of capture. A test compares the recorded hash against the
file now and fails naming every page whose shot is suspect.

It does not recapture. Recapture is manual, through the MCP bridge
against Truitt Cave, because a panel screenshot needs a human decision
about what state the panel should be in. Capture is the last phase, so
nothing is shot twice.

The cost is real: 27-plus screenshots is an afternoon, and every panel
change bills more. That is the price of showing a beginner the actual
screen.

## Tests

| Test | Fails when |
| --- | --- |
| `test_addon.py`: every tool folder has a page | a tool ships with no documentation |
| `test_addon.py`: every `tools` entry names a real folder | a page documents a deleted tool |
| `test_addon.py`: every page file and image in the index exists | an index entry points at nothing |
| `test_addon.py`: no page file or image is absent from the index | an orphan file ships |
| `test_addon.py`: every internal `href` resolves to a page in the index | a link rots |
| `test_addon.py`: every page carries the required headings | a page skips "When you reach for it" |
| `test_addon.py`: the staged package contains `CaveSurvey/Handbook/` | packaging drops it |
| `tests/handbook_shots.py`: recorded hash matches the file | a panel changed and its screenshot did not |
| `tests/js_unit.js`: `forTool`, `next`, `search` over a fixture index | the lookups break |

A parked tool has no page and must not appear in the index, matching
the existing rule that keeps a parked tool out of the README table.

## Order of work

1. `Core/CsHandbook.js`, `index.json`, the panel, the menu entry, the
   `CsPanel` helper, three placeholder pages. A working handbook that is
   nearly empty.
2. Tool pages, in menu-stage batches, six batches.
3. Task pages, in the five groups above.
4. Concept pages.
5. Process pages last, since they link everything above.
6. Screenshot pass.

Prose is drafted from the tool source, the design docs under
`docs/superpowers/specs/`, and the existing status tips, then read by
Nathan. A batch is not done until it has been read.

## Out of scope

- Start Here, the guided first-run panel. It is a separate tool that
  will drive these pages.
- Any web or PDF export of the handbook. The pages are HTML files in the
  repository and readable there; that is the whole of the external
  story.
- Translation. The pages are English, like every string in the suite.
- Search beyond substring matching.
