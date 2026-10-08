# Cross sections — design (2026-08-29)

Roadmap item **C5 (P1)**: "Draw a section line in plan, and get a
cross-section." The last large hole in Stage C, and the only one of the
suite's stated cartographic outputs with no code behind it at all.

Written overnight after shipping the export tool and Therion support,
for Nathan to review before anything is built. **Not approved yet.**
The open questions at the end are the ones whose answers change the
design; everything above them is a recommendation, not a decision.

## What already exists

More than it looks like.

- `CsLayers.CROSS_SECTION_MARKERS = "CROSS-SECTION-MARKERS"` is already
  a registered layer, and `CsSymbols.js:54` already registers a
  section-marker symbol pointing at it. The plan side has a place to
  put its marks.
- `CsLrud.stationWallPoints` already turns LRUD **and splays** into
  measured wall points, with a doctrine this feature inherits whole:
  a splay tip is a measured wall hit, sides are decided by the sign of
  (splay azimuth − passage azimuth), and nothing is ever interpolated
  between stations.
- `CsProfile`/`CsProfileDraw`/`CsProfileBox` already solve the hard
  *layout* problem this feature shares: generated geometry that lives
  beside the plan in a named, locked frame, is erased and rebuilt on
  every redraw, and can be asked "which frame owns this point?" so the
  drawing tools work in it. A section is another frame of exactly that
  kind.
- `CsRevise` already reconstructs generated geometry from XDATA, which
  is what lets a section survive a revision instead of being redrawn by
  hand.

So this is not a new subsystem. It is a third view, built from the same
measured points the plan and the elevation already use, placed by the
same frame machinery.

## The honest question: where does a section's shape come from?

A cross-section is a slice through the passage. The only measurements
that describe passage shape at a point are:

1. **LRUD at a station** — four numbers, four points. Enough for a box
   or a diamond, and honest about nothing more.
2. **Splays from a station** — real 3D wall hits, aimed where the
   surveyor pointed. Projected onto the section plane these give the
   actual shape, and they are the reason modern phone-tool surveys
   (TopoDroid, now importable) are worth sectioning at all.

There is no third source. Anything else — a smooth curve through the
four LRUD points, a shape carried over from the neighbouring station —
is drawing that is not in the data, which is the one thing
`CsLrud.js`'s header refuses to do and this feature must refuse too.

**Consequence, and the main design decision:** a section is built at a
**station**, not at an arbitrary point along the passage. A section cut
halfway between A3 and A4 would have to invent its own outline. The
tool therefore snaps the section to the nearest contributing station
and says so, rather than interpolating silently.

## The tool

**Cross Section** (`crosssection`, `cxs`), sort order 46 — beside
Feature Trace (45), because it is the other tool that reads the passage
rather than the sheet.

Two ways in, one code path:

1. **Pick a station.** The section plane is perpendicular to the
   passage azimuth at that station. `CsLrud.wallRuns` defines that as
   the azimuth of the leg that *reached* the station
   (`CsTraverse.effectiveAzimuth(leg.shot)`), not a mean of the legs
   meeting there — worth keeping identical, since a section and the
   plan walls disagreeing about which way the passage runs at one
   station would be visible on the sheet. At a junction, where the
   arriving leg is an arbitrary choice among several, the tool should
   ask rather than pick. This is the everyday case and the default.
2. **Draw a section line.** Two picks in plan define a vertical plane
   at that bearing. Contributing stations are those within a corridor
   half-width of the line (default: one station spacing, settable). This
   is for the cut a cartographer wants at an angle the passage azimuth
   does not give — across a junction, or along a rift.

In both cases the section is built from every contributing station's
LRUD and splays, projected onto the plane, and the outline is the
convex-ish hull of those points ordered by angle about the station —
straight segments between measured points, never curves, on an
`inferred` layer drawn faint, exactly as plan walls are.

## What gets drawn

Beside the plan, in a locked named frame, in the `CsProfileDraw`
pattern:

| Layer | Contents |
|---|---|
| `CTRL-SECTION-BOX` | the frame rectangle, tagged `SectionBox=<key>` |
| `CTRL-SECTION-OUTLINE` | the generated outline from measured points |
| `CTRL-SECTION-SPLAYS` | the splay rays, faint, so the evidence shows |
| `CTRL-SECTION-STATIONS` | the station dot and its centreline cross |
| `CTRL-SECTION-TEXT-LABELS` | "A–A′", the scale, the station name |
| `SECTION-WALLS` etc. | the caver's own traced walls (the twin-layer split `PROFILE-*` already uses) |
| `CROSS-SECTION-MARKERS` | **in the plan**: the cut line, its arrows and its letter |

The `CTRL-` half is generator-owned and erased on every redraw; the
unprefixed half is the caver's work and is never touched. That split
already cost this suite one incident (see the NAMING TRAP note in
`CsLayers.js`) and is not up for reinvention.

New layers must also be added to the plan template, or
`test_registry_layers_exist_in_plan_template` fails — correctly.

## Modules

- `Core/CsSection.js` — pure. Given a survey, a resolved network, a
  plane (origin + bearing) and a corridor width: which stations
  contribute, each measured point projected into plane coordinates
  (horizontal offset, elevation), the ordered outline, and the section's
  extent. No document, so it tests under node like every other Core
  file.
- `Core/CsSectionDraw.js` — the QCAD half: frame, outline, splays,
  labels, erase-and-rebuild, XDATA tags.
- `Core/CsSectionBox.js` — "which section owns this point?", the exact
  twin of `CsProfileBox`, so Feature Trace and the Shaped Lines buttons
  work inside a section frame without learning anything new.
- `CrossSection/CrossSection.js` — the tool: pick, options, report.

## Tags, so a section survives a revision

Every generated entity carries `Section=<key>`; the frame also carries
the plane that made it (`SectionStation`, `SectionBearing`,
`SectionWidth`). `CsRevise` then rebuilds sections from the drawing the
same way it rebuilds the profile, and a re-surveyed trip moves its
sections with it instead of stranding them.

## Tests

- `tests/js_unit.js` — `CsSection` projection and ordering: a splay at a
  known bearing and inclination lands at a known (offset, elevation); a
  station's four LRUD numbers give four points on the right sides; a
  station outside the corridor contributes nothing; a section with no
  splays at all still produces the LRUD box; the plane's sign convention
  (which way is "right" in the section) is asserted, not assumed.
- `tests/cross_section_run.js` — the tool's own entry point against a
  real off-screen document, in the shape `export_cave_survey_run.js` and
  `generate_profile_run.js` established: draws a fixture survey with
  splays, cuts a section, and reads the generated entities back.
- `tests/test_addon.py` — wiring, unique sort order, icon, README row,
  and the new layers present in the template.

## Out of scope, named so they stay out

- Interpolated sections between stations (see above — there is no data).
- Smooth or spline outlines.
- Sections of the *elevation* frame; sections cut through the plan only.
- Cross-section symbol libraries (breakdown fill inside a section is
  Scatter Breakdown's job once the frame exists).
- Automatic placement/packing of many sections on the sheet. First
  version puts each section where the caver asked for it.

## Open questions for Nathan

1. **Station-snapped, or corridor?** The recommendation is to build
   both from one code path, defaulting to station-snapped. If you only
   want the simple one first, the corridor half is a clean thing to cut.
2. **Where should a section land on the sheet?** Beside the plan at the
   pick point (simple, can overlap other work), or in a reserved strip
   the way profile bands stack? The profile answered this with
   `CsProfile.layout`; sections could reuse it or deliberately not.
3. **Outline rule.** Ordered hull about the station is the safe reading
   of "connect the measured points". A passage with a re-entrant (a
   ledge undercut) is genuinely concave, and a hull would cut the corner
   off it. The alternative — order by angle and connect in sequence,
   concavities included — is more faithful and noisier on sparse splay
   data. Which failure do you prefer?
4. **Does a section need to print at its own scale?** A 3 m passage
   drawn at plan scale is a smudge. Per-section scale with the scale
   stated in the frame label is the usual cartographic answer, and it
   means the frame is not in plan coordinates — which the box/frame
   machinery has never had to handle before.
