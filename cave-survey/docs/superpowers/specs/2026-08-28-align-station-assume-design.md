# Align Image station assumption — design

2026-08-28. Nathan's ask, refined in session: "keep track of the next
station without an assigned point on the survey scan, and let me
override it in the command line — when I click, ask, but assume the
next unentered station."

## Problem

Align Image pairs each station twice: click it on the scan, then click
where it goes in the drawing. On a real cave the second click is the
slow half — zooming around crowded linework to find B7 — and the tool
already knows where every station is plotted (`CsTags.collectStations`)
and what order the survey visits them in (the drawing's tags,
reconstructed by `CsRevise.resolveAsDrawn` — Nathan's "fingerprint").

## Decisions (Nathan's answers)

- **Seed by typing, no first guess.** The first station of a scan is
  typed at the command line (or clicked manually, as today). Every
  later pair assumes the NEXT station and the prompt says so.
- **Advance in survey shot order, not name order.** Branches: a new
  run starts where it ties into the previous one, and name-sequence
  order (B4 → B5) would walk past the tie. First-appearance order over
  the reconstructed survey's legs follows the notebook: after B4 comes
  C1 exactly when the survey went there next.
- **Assigned stations persist on the scan itself** (tag on the image
  entity), so a half-aligned scan resumes at the right station in a
  later session. "Next unentered" skips them.

## Shape

New pure Core `CsStationOrder.js` (node-tested in js_unit):

- `walkOrder(survey)` — station names in first-appearance order over
  the survey's legs (`shot.splay` skipped, trips in reconstruction
  order — CsRevise already merges by (trip, shotSeq)).
- `nextUnassigned(order, lastName, usedSet, plotted)` — the first name
  strictly after `lastName` in `order` that is not in `usedSet` and IS
  in `plotted` (a station without a drawn point cannot be a target).
  `lastName` null means start of the order. Returns null when the walk
  runs dry.
- `parseAssigned(value)` / `serializeAssigned(names)` — the image tag
  `AlignedStations`, a comma-joined list, CAPPED at 800 chars serialized
  (dxflib's 1024/line rule, [[cave-survey-elevation-datum-trap]] family
  discipline: no unbounded tag, ever). Overflow drops the OLDEST names
  — they were aligned first and are least likely to be re-aligned.

AlignImage changes (state machine stays three states):

- Lazy context, built the first time a station name is used: name→pos
  from `CsTags.collectStations`, walk order from
  `CsRevise.resolveAsDrawn`. A drawing with no tagged stations (or a
  legacy one where reconstruction fails) never builds it — the tool
  behaves exactly as today.
- `commandEvent`: typed text that exactly matches a plotted station
  name (case-insensitive) is accepted at either point-picking state.
  At SettingDestPoint it completes the pending pair at that station's
  plotted position. At SettingSourcePoint it just (re)sets the
  assumption for the next pair. Exact station names win over the
  existing `scale`/`noscale` prefix matches; those keep their prefix
  behavior otherwise.
- Assumption = `nextUnassigned(order, lastStation, used, plotted)`,
  where `used` = pairs completed this run plus the scan's
  `AlignedStations` tag, and `lastStation` = the most recent
  name-resolved station (typed or assumed; manual drawing clicks do
  not move the cursor along the order).
- SettingDestPoint prompt with an assumption standing:
  "STATION n = B7 — Enter accepts, type another name, or click in the
  drawing". `enterEvent` in that state accepts the assumption (today
  it only warns). Without an assumption the prompt and Enter behave
  exactly as today.
- On apply, the names used this run are UNIONED into the image's
  `AlignedStations` tag via `RModifyObjectsOperation` (CalloutSync's
  pattern), inside the same operation as the transform where possible.
  Only the aligned IMAGE entity is tagged; aligning plain linework
  (no image in selection) tags nothing.

## Error handling

Typo at the prompt: text that is neither a command nor a plotted
station name → user warning naming the nearest few candidates, pair
state unchanged. Reconstruction throwing (legacy drawing) → context
stays null, tool silently manual. Assumption exhausted (walk ran dry)
→ prompt reverts to the manual wording for that pair.

## Tests

Pure: walkOrder on a branched survey (the tie-in case: B-run then
C-run tying at B2), splay skipping, nextUnassigned skipping used and
unplotted names, seed-null start, dry-end null, tag round-trip and the
800-char cap. Engine: existing align suites must stay green
(tests/align_image_frame.js). Live: seed B1 on a Truitt scan, watch
the prompt walk B2, B3, override once, confirm the tag lands on the
image and a re-run resumes past the assigned names.
