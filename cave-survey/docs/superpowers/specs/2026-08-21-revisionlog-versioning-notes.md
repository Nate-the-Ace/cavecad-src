# RevisionLog × GitHub versioning — integration notes

**Date:** 2026-08-21
**For:** `docs/superpowers/specs/2026-08-20-github-versioning-design.md`
**From:** the revision-framework side (shipped in 2.7.1)

Nathan flagged that the revision log matters for the versioning work. It does, in four
concrete places. Written as notes rather than edits to that design — the calls are its
author's to make.

## What the log actually is, as of 2.7.1

An append-only newline-joined text property, `RevisionLog`, in the `CaveSurvey` custom
property group, on ONE entity: the trip-0 anchor station point (falling back to the
lowest-numbered trip anchor on drawings made before that rule existed). Both revision
paths write it through `CsRevise.appendLog`. Real entries:

```
trip 0 (1998-07-04|N. Schonegg, J. Bender) redrawn from the notebook page: declination -4.5 -> -3.25 (user), 18 shots replaced, 16 stations moved
  linework: 1 moved
trip 1 (2010-10-10|SOLO) added from the notebook page, 1 shot
trip 0 declination 2 -> 6 (igrf)
```

Deliberately **no timestamps** — this codebase avoids `Date` for test determinism. That is
convenient here rather than a limitation: git supplies the time, and the log supplies the
meaning. The two compose instead of disagreeing.

## 1. It is the commit message you are missing

Decision 4/5 auto-commit and auto-push on every save. A generic message ("save") makes the
history unreadable, which is the same problem a 12,000-line DXF diff has. The log lines
added since the last commit ARE the description of what changed, in the surveyor's terms.

Suggested shape: on commit, read the log, diff against the value recorded at the previous
commit, and use the new lines as the message body. A save with no new log lines is a
geometry-only edit — say that, rather than inventing prose.

## 2. It is the PR body you are generating

Same source, wider window: the lines added since the branch point are the trip's history.
That is exactly "a survey trip becomes a reviewable unit carrying its own survey summary"
without generating anything.

## 3. The review sidecar should carry it — that is what makes it reviewable

Today the log is inside the DXF as XDATA. A PR reviewer on github.com cannot see it
without opening CaveCAD, which defeats the point. `survey/*.shots.tsv` is already the
deterministic, diffable artifact; the log belongs beside it (its own
`survey/*.revisions.log`, or a header block in the tsv). Append-only text diffs cleanly:
a revision shows up as added lines, not as a rewrite.

Note it is the ONE artifact that a DXF diff can never show usefully, because a revision
rotates every coordinate in the file.

## 4. PRIVACY — the one thing to decide before building it

The sidecar deliberately omits coordinates so the design does not add "a second,
greppable copy" of the fact worth protecting. **The same reasoning applies to the log, and
it has not been applied yet.** Every entry names a trip by its fingerprint, which is
`date|team` — so the log is a record of WHO surveyed WHICH DAY, in plain text, and
exporting it to a sidecar creates exactly the second greppable copy that reasoning rejects.

For personal names this is much weaker than an entrance coordinate, and decision 1
(private repos, hard enforced, fails closed) already contains it. But it is a real choice,
so make it explicitly rather than by omission. Three options:

- Export the log verbatim. Simplest, most useful for review; personal names ride along.
- Export with the team field elided (`trip 0 (1998-07-04) redrawn: …`). Keeps the
  diagnostic value — dates, declinations, counts — and drops the personal data. The team
  is still in the DXF, which stays the single copy.
- Do not export; keep the log DXF-only and use it for commit messages and PR bodies only,
  where it is transient rather than committed. Loses the reviewable history.

Middle option looks right to me: the reviewer needs to know a trip's declination changed
by 1.25 degrees, not who held the compass. But it is a judgement about Nathan's team, not
a technical constraint.

## Two hazards worth knowing

**Stock QCAD drops it.** The log persists as real DXF XDATA only through the CaveCAD
fork's writer; opening and saving a drawing in stock free QCAD silently loses it, as it
loses every other tag. Versioning cannot treat the log as guaranteed-present history — a
gap in it means someone saved elsewhere, not that nothing happened.

**Every Draw used to destroy it.** Fixed in 2.7.1, but drawings saved before that may have
truncated logs; do not read a short log as evidence of a short history.
