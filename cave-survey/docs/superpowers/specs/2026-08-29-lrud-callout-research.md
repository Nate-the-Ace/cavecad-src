# Dynamic LRUD callout — research note

2026-08-29. Nathan: "Research adding a dynamic callout that has a leader
that points to a station and pulls that station's LRUDs and then displays
them as a block that the leader is attached to."

Findings, not a design. Every engine claim below was probed live today.

## The precedent is exact

The suite already has a survey-derived callout: `CsCallout.KIND_ELEV`,
the spot floor elevation. It works the way this feature needs to work.

- A callout is a LINKED PAIR — one `RTextEntity` and one
  `RLeaderEntity`, joined by a shared `CalloutId` in XDATA. QCAD has no
  multileader; `RLeaderEntity` is a polyline plus an arrowhead flag with
  no text member.
- An elevation callout stores its PROVENANCE, not just its answer:
  `ElevFrom`, `ElevTo`, `ElevFraction` say which leg it was sampled on
  and where along it.
- `CalloutWrite.refreshElevations(doc, di, survey, resolved)` re-derives
  every one of them on a draw, and reports `{updated, upgraded,
  downgraded, lost, unchanged}`.
- It refuses to overwrite a HAND-EDITED label: it recomputes what the
  stored value WOULD have rendered as, and if the text on the drawing
  differs, a human changed it and it is left alone.
- A callout whose basis has vanished from the survey is COUNTED as
  `lost`, never silently deleted.

So "pulls a station's data and redraws itself on Draw" is a solved
problem here. What is new is only that the content is GEOMETRY rather
than a line of text.

## The content member: probed, and blocks work

The question was whether a callout's content can be a block whose
definition the tool regenerates. It can. Probed headlessly:

| Operation | Result |
|---|---|
| `new RBlock(doc, "CS_A1", origin)` + `RAddObjectOperation` | block created, id returned |
| `line.setBlockId(bid)` + add | entity lands INSIDE the block definition |
| `RBlockReferenceEntity` + `RBlockReferenceData(bid, pos, scale, rot)` | instance placed, bbox `100,100 to 110,100` |
| add a second line to the definition, then `ref.update()` | **instance bbox becomes `100,100 to 110,125`** |
| `doc.queryBlockReferences(bid)` | finds the instances |
| `setCustomProperty` on the reference | present — XDATA rides on the instance |

That fourth row is the crux: redefining the block updates the placed
instance. A per-station LRUD block can therefore be regenerated in place
on every Draw without touching where the caver put it.

`CsCallout.reflow(box, tips, opts)` takes a plain `{x1,y1,x2,y2}` box,
not a text entity — so a block reference's own bounding box feeds it
unchanged, and the leader attaches to the block exactly as it attaches to
text today.

## The three shapes for the content

**A — block reference (recommended).** A third `CalloutRole`, holding one
`RBlockReferenceEntity` per callout, block named per station. One entity
for the caver to drag, one definition to regenerate, and the bounding box
`reflow` already wants. Unknown: nothing regenerates a block definition
in this suite yet, so erase-and-rebuild INSIDE a definition needs the
same care `CsProfileDraw.erase` takes outside one.

**B — loose tagged geometry.** N lines carrying the `CalloutId` and a
role. No block machinery, and it reuses the erase-and-redraw pattern the
profile already uses. But moving the callout by hand means dragging a
scatter of separate lines, which is a real regression against a block.

**C — no callout; the existing marker convention.** A
`CROSS-SECTION-MARKERS` symbol at the station with a letter, and the
section itself drawn elsewhere. This is what the layer already exists
for.

## The tension is settled: no grid

An earlier decision this session put cross sections in a grid under the
elevation. **Nathan dropped it (2026-08-29): "we're giving up on the
cross section grid, forget that i wanted it. the cross section callout
is a much better solution."**

The two could never have coexisted anyway -- a leader cannot span from a
station in the plan to a cell below the elevation and stay readable.
The callout wins on its merits: the section sits beside the passage it
describes, at the point it describes, which is where a reader looking at
that passage already is.

Consequences:
- Open question 2 of the cross-section design ("where should a section
  land on the sheet?") is ANSWERED: beside its station, on a leader.
- `CsProfile`'s reserved band gaps are no longer needed for sections.
  They still hold notes; nothing to undo.
- Nothing needs a per-cell grid layout, a `SectionSeq`, or a
  reflow-on-append rule. All of that was grid bookkeeping.

## What is already decided and unaffected

- Sections draw at their OWN scale with the scale stated in the label
  (answered this session; open question 4 of the cross-section design).
- `docs/superpowers/plans/2026-08-29-cross-section-layers.md` stands
  either way: every shape above needs the section layers, the `section`
  frame answer, and the template rows.

## What a design would still have to answer

- Which stations get one — every station is hundreds of blocks on a real
  cave, and this was the question the callout idea replaced rather than
  answered.
- Whether the block shows LRUD alone or LRUD plus splay-derived wall
  lines. "be sure to show LRUDs and wall lines for each station" reads as
  both, and `CsLrud.stationWallPoints` already produces exactly those
  measured points from LRUD AND splays.
- The hand-edit rule. A text label can be compared against what it would
  have rendered; a regenerated block cannot be compared that cheaply, so
  "the caver adjusted this one" needs its own answer — most likely a tag
  the way aligned scans use their anchors.
