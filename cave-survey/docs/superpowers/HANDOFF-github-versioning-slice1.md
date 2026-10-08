# GitHub versioning, slice 1 — overnight handoff

**Written 2026-08-21 while you slept.** You said to run with my own judgement, so
the calls below are mine; every one is reversible and every one is explained.

## Directory rename, 2026-08-21

The main checkout was `~/Documents/github/qcad-azimuth-tool` and is now
`~/Documents/github/cavecad-tools`. The old name was actively misleading: it
belongs to the ARCHIVED GitHub repo (`ndschonegg/qcad-azimuth-tool`,
`isArchived: true`), while this checkout's remote is `ndschonegg/CaveCAD`. Not
renamed to `CaveCAD` because macOS is case-insensitive and
`~/Documents/github/cavecad` already symlinks to `cavecad-src`, the fork's app
source. Paths below are updated; the `qcad-ghv` worktree path is unchanged and
its linkage was repaired.

## Where the work is

    worktree:  ~/Documents/github/qcad-ghv
    branch:    github-versioning
    NOT in:    ~/Documents/github/cavecad-tools  (left alone -- a parallel
               session was committing to v2 all night)

A git worktree, so `v2` stayed checked out in the main directory for that other
session the whole time.

## The three things I did NOT do

1. **Nothing pushed.** No push, no PR, no `gh repo create`. The whole feature is
   about pushing to GitHub; authorising that is yours.
2. **No live `gh auth` mutation.** Never ran `auth login`, `logout`, `refresh`, or
   `setup-git`. Your credentials are untouched -- verified with a read-only
   `gh auth status` after every round: still `ndschonegg`, still carrying `repo`.
3. **Task 8 is not finished, and is not claimed as finished.** It needs a human to
   launch CaveCAD from Finder and click through the Cave Survey menu. I cannot
   drive a macOS GUI. What I could verify headlessly, I did -- see below.

## Merge with v2

As of the snapshot I tested: `github-versioning` and `v2` had diverged (we were
19 ahead, they 9 ahead), they merge **textually clean**, and the combined suite
**passes at 1852 assertions**. Only shared file is `tests/js_unit.js`; since it is
a flat top-level script a name collision was a real risk and did not happen.

Re-check before merging for real -- that session may have kept going. The test I
ran was a throwaway detached worktree, both branches left untouched.

## How to run what exists

    cd ~/Documents/github/qcad-ghv
    ./tests/run_all.sh                # structural + syntax + unit
    ./tests/run_all.sh --publish      # adds icon/status-tip checks

macOS has no `timeout`; if you want a watchdog:

    perl -e 'alarm 180; exec @ARGV' ./tests/run_all.sh

The node leg only runs automatically when CaveCAD is absent, so run it by hand:

    node tests/js_unit.js

## What the reviews cost, and why that is the story

Twenty-plus defects in MY plan were found during execution. Three of them would
have shipped silently:

- **The privacy gate said yes to a non-private repo.** `CsHub.parseVisibility`
  used `String(j.visibility)`, so `{"visibility":["PRIVATE"]}` made `isPrivate`
  return true -- because `String(["PRIVATE"])` is `"PRIVATE"`. That is the one
  function standing between a drawing carrying exact entrance coordinates and a
  public repo.
- **A log that wrote nothing for two commits.** Two Qt calls that do not exist in
  this engine, both swallowed by the file's own defensive try/catch, while every
  test passed.
- **An infinite loop reachable from the public parser.** `unquotePath` entered its
  octal branch on one digit but only advanced the cursor on three. A hang in a CAD
  app on the auto-push save path is a force quit with unsaved survey work gone.

Every one came from code written against a remembered API or a remembered output
format instead of a probed one. The plan's "Ground rules" section grew three rules
tonight as a result: capture fixtures from the tool, verify unfamiliar APIs before
using them, and validate with `typeof` rather than truthiness plus `String()`.

## Verified live in the engine (evidence in the scratchpad)

- `gh auth login --web` works with **no TTY** -- prints the one-time code, blocks
  polling, never demands a terminal. This is what makes in-app sign-in possible.
- **The Finder-PATH bug is real.** Under a stripped environment CaveCAD gets a
  PATH with no `/opt/homebrew/bin`, and a bare `gh` fails with
  `execve: No such file or directory`. Absolute candidates first is not paranoia.
- **Three gh failures share one signal** -- logged out, offline, and unknown-flag
  all give exit 1 with empty stdout. Only the stderr text separates them. Without
  classifying it, the ladder would tell an offline surveyor to sign in; they would
  sign in successfully and still be broken.
- Every Qt class the tool and dialog need exists, and `QCoreApplication.processEvents`
  is real while `QApplication.processEvents` is **undefined**.

## Task status at hand-off

| # | Task | State |
|---|------|-------|
| 1 | `CsProc` -- the one process runner | CLOSED, 3 review rounds |
| 2 | `CsGit` -- argv builders + parsers | CLOSED, incl. a Critical infinite loop |
| 3 | `CsHub` -- gh argv, JSON, privacy gate | CLOSED, 3 rounds |
| 4 | `CsSetup` discovery | CLOSED |
| 5 | The six-rung preflight ladder | CLOSED, 4 rounds |
| 6 | `GitHubSetup` tool + icon + menu | CLOSED, spec + quality |
| 7 | Device-flow sign-in dialog | CLOSED, spec + quality |
| 8 | GUI verification | NOT DONE -- needs you at the keyboard |

Assertions: 1643 -> 2044 engine, 784 -> 1173 node. `--publish` gate passing.

## What Task 8 still needs from you

I verified everything a script can reach, including running the real ladder
end-to-end inside CaveCAD's engine against this machine -- all six rungs green,
matching the real `gh auth status` and `git config` state.

What a script cannot reach, and what I did NOT claim:

1. That "GitHub Setup" actually appears in the Cave Survey menu.
2. That the ladder is legible on screen (see the addendum on rich-text
   collapse -- this one nearly shipped as an unreadable run-on line).
3. That the sign-in dialog renders, that the one-time code updates in place,
   and that Open/Cancel respond to real clicks.
4. That `dialog.rejected` fires from a real close-box click or Escape --
   trusted on precedent, not probed.
5. That `show()` plus a QTimer keeps the UI responsive in practice.
6. The whole sign-in flow against a real `gh` process. I was forbidden from
   running one, deliberately: it would have touched your live credential.

To do it:

    cd ~/Documents/github/qcad-ghv
    ./tools/publish.sh
    open -a CaveCAD          # from Finder, NOT the binary -- see below

Launch via `open`, not `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD`. The
binary inherits your shell PATH and would hide the exact Finder-PATH bug the
discovery ladder exists to prevent.

Then: Cave Survey > GitHub Setup. Expect six rungs, all OK, on this machine.

## Two findings from the last round worth keeping

**Per-repo git identity belongs to the CLONE step, not the setup ladder.** The spec
chose per-repo so the plugin would never silently rewrite a developer's global config
-- a good instinct that assumed a repo is in scope. In slice 1 there is none: the tool
runs with no drawing open and CaveCAD's cwd is the app bundle's Resources, where a
local `git config` exits 128 and writes nothing. So slice 1 now ASKS, then writes
global; slice 2's clone flow should do per-repo config where a repo really exists.

**CsProc has no setWorkingDirectory.** Every per-repo git operation in slice 2 will
need that option added, or `git -C <path>`. Noted in CsProc.js itself.

**A Qt detail that is load-bearing and non-obvious.** In this bridge
`QProcess.FailedToStart` and `QProcess.NotRunning` are BOTH 0. Testing
`proc.error() === QProcess.FailedToStart` is nonetheless safe, because `error()`
returns UnknownError (5) when nothing went wrong -- measured:

    successful process  -> error()=5, exitCode()=0
    non-zero exit       -> error()=5, exitCode()=3
    missing binary      -> error()=0, exitCode()=255, errorString "execve: No such file"

Note `exitCode()` is 255 for a missing binary, not the 0 Qt's docs imply. Do not
"simplify" that comparison against a hardcoded number.

## Final state

- 39 commits on `github-versioning`, working tree clean.
- Nothing pushed. `gh auth status` verified unchanged: ndschonegg, active, `repo` scope.
- `tools/publish.sh` deliberately NOT run -- it would have downgraded your installed
  suite, since this branch predates the parallel session's loop-closure work.
- The real ladder, run end-to-end inside CaveCAD's engine: six green rungs.
