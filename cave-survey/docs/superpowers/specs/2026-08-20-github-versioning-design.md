# GitHub Versioning for Cave Drawings — design

**Date:** 2026-08-20
**Branch:** github-versioning (off v2)
**Status:** Approved (seven decisions taken by Nathan during brainstorming)

## Goal

Cave drawings live on one laptop. The goal, in Nathan's framing, is **GitHub as cloud
storage, with versioning as the very helpful bonus**: a drawing saved in CaveCAD should
be off the machine within seconds, and a survey trip should be reviewable as a discrete
change rather than a 12,000-line DXF diff.

Three capabilities, in priority order:

1. **Push** — saved work reaches GitHub without the surveyor thinking about it.
2. **Clone** — a project or cave repo comes down with its folder conventions intact.
3. **Pull requests** — a trip becomes a reviewable unit carrying its own survey summary.

All three assume a working, authenticated `gh`, which a new surveyor does not have — so
**onboarding is part of the feature, not a prerequisite to it.**

## Why this is feasible at all

Probed in CaveCAD 3.33.0's engine on 2026-08-20 (`-no-gui -autostart`):

| Capability | Result |
|---|---|
| `QProcess` construct, `start`, `waitForFinished`, `readAllStandardOutput` | **available**, ran `git --version` successfully |
| `gh` on PATH from inside CaveCAD | **yes** — `/opt/homebrew/bin/gh` 2.97.0, `gh auth status` reports logged in as `ndschonegg` |
| `QDialog`, `QTreeWidget`, `QListWidget`, `QProgressDialog`, `QTextEdit`, `QFileDialog` | available |
| `QNetworkAccessManager` | **absent** |
| `QTemporaryDir` | absent |
| `git-lfs` on the host | **not installed** |

A third result is a trap rather than a capability: the probe launched CaveCAD **from a
terminal**, so it inherited a login shell's `PATH` including `/opt/homebrew/bin`. A macOS
GUI app launched from Finder gets a minimal `PATH` that does **not** include Homebrew, so
`gh` would be reported "not found" on a machine where it is installed. Executable
discovery therefore must not rely on `PATH` — see the resolution ladder below.

Two consequences are load-bearing. No `QNetworkAccessManager` means **the GitHub API is
reachable only through the `gh` CLI** — there is no in-process HTTP fallback, so `gh`
being absent or unauthenticated is a first-class state the design must handle, not an
edge case. And `QTableWidget` is still missing from this bridge (see
[[qcad-plugin-conventions]]), but `QTreeWidget` is present, so list-shaped UI is fine.

## Decisions taken

| # | Decision |
|---|---|
| 1 | **Private repos only, hard enforced.** Any repo GitHub reports as non-private is refused for clone, push and PR. No override, no confirmation dialog. |
| 2 | **Repo scope: cave-per-repo plus a project index.** A project repo carries `CAVES.json` listing member cave repos and clones them on demand. |
| 3 | **PR review artifacts: a deterministic survey sidecar plus a generated PR body.** No plot/PDF export committed. |
| 4 | **Session branch, auto-commit on save.** Opening a drawing from a clone puts the next save on a session branch; every save commits. |
| 5 | **Auto-push after every save.** Backup value comes from it being automatic. |
| 6 | **Small team, one cave each.** No merge machinery; warn when another open PR touches the same cave. |
| 7 | **Clones live in `~/Documents/Cave/` directly**, and **`scans/` is gitignored by default.** |
| 9 | **The revision log drives commit messages and PR bodies, and exports verbatim** — team names included. |
| 8 | **The plugin onboards a new user end to end** — detects a missing `git` or `gh`, gives platform-specific install links, and drives the GitHub login itself rather than assuming an authenticated CLI. |

Two further calls made in the design and open to reversal at spec review:

- **The sidecar carries no coordinates.** Entrance lat/lon stays only in the DXF.
- **The pre-push hook fails closed** when it cannot verify visibility.

## Scope of the privacy rule: MAPS are private, the CODE is not

Stated explicitly because the two live side by side and the distinction is
load-bearing (confirmed by Nathan, 2026-08-21):

- **Cave drawing repositories are private, hard enforced.** They carry entrance
  coordinates in LocationPick XDATA and `GeoLat`/`GeoLon` on the anchor station.
  Everything below applies to them.
- **This add-on's own source repository is public**, and that is intended — it is
  GPLv3 code derived from QCAD. Its test fixtures use synthetic local grids
  (`*fix RA 0 0 0`, `#Fix W1 1000.00 2000.00 100.00`), never real coordinates, and
  `GeoLat`/`GeoLon` appear in it only as tag *names*. Nothing in the source tree
  identifies a cave.

So `CsHub.isPrivate` gates the repositories the plugin creates and pushes to. It
says nothing about where this code lives.

## Privacy: the constraint that shapes everything

The project's first rule is never to expose cave entrance locations
([[cave-location-privacy]]). Working DXFs carry exact entrance lat/lon in LocationPick
XDATA and in `GeoLat`/`GeoLon` on the georeferenced anchor station. Pushing them to
GitHub sends that to a third-party host where it is replicated, backed up, and
**permanent in history even if a later commit strips it**. Private repos make this
acceptable; nothing else does.

Enforcement is therefore in three places, deliberately redundant:

1. **`CsHub.assertPrivate(owner, repo)` before every clone, push and PR.** Runs
   `gh repo view <owner>/<repo> --json visibility`. Anything but `PRIVATE` aborts with a
   message naming what would leak.
2. **A `.githooks/pre-push` script in every scaffolded repo**, which re-asks the same
   question at the git level so a plain `git push` from a terminal is covered too.
3. **The sidecar omits coordinates.** A georeferenced station is recorded as a bare
   marker line (`# geo A1`) with no values. The DXF stays the single copy of the one
   fact worth protecting, rather than the design adding a second, greppable copy.

**The hook fails closed.** If `gh` is missing, unauthenticated, or the API call fails,
the hook refuses the push. "Could not verify" is not "it is fine" — under decision 1
there is no path where an unverified remote gets data.

**Hooks do not activate on clone.** `core.hooksPath .githooks` is repo-local config that
a fresh `git clone` does not set. `CloneProject` and `InitCaveRepo` set it explicitly.
A teammate who clones with plain `git` has no hook until they run `CloneProject` — which
is exactly why enforcement point 1 exists inside the plugin and is not delegated to the
hook.

## Onboarding a new user

A new surveyor has no `gh`, possibly no `git`, no token, no git identity, and no
credential helper. Every one of those produces a different failure, and three of them
produce failures that look like something else: a missing credential helper looks like a
password prompt that cannot be answered, an unset `user.email` looks like a commit
refusing to run, and a token without the `repo` scope makes a private repo return **404
rather than 403**, which reads as "that repo does not exist" instead of "you cannot see
it". So onboarding is a ladder with a named remedy at every rung, not a single check.

### Executable discovery comes first

`CsSetup.resolve(name)` finds `git` and `gh` by probing candidates in order and caching
the winner in `RSettings` under `CaveSurvey/GitPath` and `CaveSurvey/GhPath`:

| Platform | Candidates, in order |
|---|---|
| `osx` | `/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, then `PATH` |
| `win` | `%ProgramFiles%\GitHub CLI\gh.exe`, `%ProgramFiles%\Git\cmd\git.exe`, `%LOCALAPPDATA%\Programs`, then `PATH` |
| `linux` | `/usr/bin`, `/usr/local/bin`, `$HOME/.local/bin`, then `PATH` |

`PATH` is the last resort, not the first, because of the Finder-launch trap above. A
cached path that no longer resolves is discarded and the ladder re-runs — an upgrade or a
Homebrew prefix change must not require clearing settings by hand.

### The ladder

Each rung either passes or shows one dialog whose text is a remedy, and re-checks on
demand rather than requiring a CaveCAD restart.

**1. Is `git` installed?** `git --version`. Missing:

| Platform | What the dialog offers |
|---|---|
| macOS | `xcode-select --install` (copyable), link <https://git-scm.com/download/mac> |
| Windows | link <https://git-scm.com/download/win>, `winget install -e --id Git.Git` |
| Linux | link <https://git-scm.com/download/linux> |

**2. Is `gh` installed?** `gh --version`. Missing:

| Platform | What the dialog offers |
|---|---|
| macOS | `brew install gh`, or the `.pkg` from <https://github.com/cli/cli/releases/latest>, link <https://cli.github.com/> |
| Windows | `winget install -e --id GitHub.cli`, link <https://cli.github.com/> |
| Linux | link <https://github.com/cli/cli/blob/trunk/docs/install_linux.md> |

Every dialog carries the canonical <https://cli.github.com/> link, a **Copy command**
button, and a **Check again** button. Links open through `QDesktopServices.openUrl` —
the plugin never downloads or runs an installer itself.

**3. Is `gh` authenticated?** `gh auth status`. If not, the device flow, which was probed
working on 2026-08-20 and is the primary path:

```
gh auth login --web --git-protocol https --hostname github.com \
              --scopes repo,read:org --clipboard
```

Verified behavior without a TTY: `gh` prints `First copy your one-time code: XXXX-XXXX`
and `https://github.com/login/device`, then blocks while polling GitHub. It does **not**
error out for want of a terminal and does **not** wait for an Enter keypress. The plugin
therefore:

1. starts the process, reading **both stdout and stderr** — gh prefixes those lines with
   `!`, its stderr convention, and the exact stream is a gh implementation detail no
   design should depend on;
2. regex-matches `([A-Z0-9]{4}-[A-Z0-9]{4})` out of whichever stream carries it;
3. shows a non-modal dialog with the code in a large font, a note that `--clipboard`
   already copied it, and an **Open github.com/login/device** button;
4. waits for exit, Cancel killing the process; gives up at gh's own 15-minute device-code
   expiry and says so;
5. on exit 0 re-runs `gh auth status` to confirm rather than trusting the exit code.

**No secret passes through the plugin on this path** — the browser and gh's own keychain
storage handle it end to end. That is why the device flow is primary rather than a token
box.

**Fallback: paste a token.** For a machine that cannot open a browser, a **Use a token
instead** button opens a field with `QLineEdit.Password` echo mode, and pipes the value to
`gh auth login --with-token` over stdin. The dialog links
<https://github.com/settings/tokens> and states the one required scope, `repo`. Handling
rules, non-negotiable: the value is written to the process's stdin and nowhere else —
never a variable that outlives the call, never a file, never a command-line argument
(where it would be visible in `ps`), and `CsProc` must redact `ghp_`/`gho_`/`ghu_`/`ghs_`
patterns and every `--with-token` stdin write from `cave-git.log`. A logged token is a
leaked token.

**4. Does the token carry the `repo` scope?** `gh auth status` reports token scopes. An
existing token authorized for something else will pass rung 3 and then make every private
repo look nonexistent. Missing scope offers `gh auth refresh -s repo`, which is also the
remedy when a project later needs `read:org` for an org-owned repo.

**5. Is git's credential helper configured?** Read with
`git config --get-regexp ^credential`. Without any helper an HTTPS push prompts for a
password on a terminal that does not exist, so it hangs rather than failing.

Two corrections to an earlier draft of this rung, both from measurement rather than
reasoning. It said to check by running `gh auth setup-git` — but that command
*configures* the helper, so the check would have been the mutation, and merely opening
the setup dialog would rewrite the user's git config. A diagnostic must not have that
side effect. And it required gh's own helper; on the development machine
`credential.helper` is `osxkeychain`, no gh helper is configured at all, and gh plus
push work fine. **Any** helper passes. `gh auth setup-git` is offered as a remedy when
there is none, never run as a probe.

**6. Is there a git identity?** `git config --get user.name` and `--get user.email`. Empty:
fill them from `gh api user` — `name` (falling back to `login`) and the noreply address
`<id>+<login>@users.noreply.github.com`, so a surveyor's real email address never lands
in a commit that is then permanent in history. Default scope is **per-repo** (`git config`
without `--global`), because a plugin silently rewriting a developer's global git identity
is an overreach; a **Set globally** checkbox is offered for the plain-laptop case.

### When the ladder runs

- **On demand** from `GitHubSetup`, which shows every rung with a pass/fail state so a
  half-configured machine is legible at a glance.
- **Once per session, automatically**, the first time any other git tool runs — including
  the save wrapper's first attempt. It must never run on every save; the existing
  "git is unavailable this session" latch covers repeat failures, and a modal appearing
  mid-drawing on save is the one thing the save path may not do.
- **Never at CaveCAD startup.** A surveyor who has no interest in GitHub must not meet a
  login dialog for opening a drawing.

### Deliberately out of scope

SSH keys (`--git-protocol https` throughout, and `--skip-ssh-key` on login), GitHub
Enterprise hostnames, and organization or SAML SSO authorization flows. Each is a real
setup a teammate might have, and each is better served by telling them to run
`gh auth login` in a terminal than by the plugin reimplementing gh's prompts.

## Repo layout

### Cave repo

```
drawings/                  .dxf — the source of truth
survey/                    generated *.shots.tsv review sidecars
                           and *.revisions.log, the exported revision log
notes/                     trip notes, markdown
exports/                   PDFs handed out; exports/tmp/ ignored
scans/                     ignored — stays local
CAVE.json                  slug, display name, units, station prefix. No coordinates.
README.md                  cave name, station convention, "clone with CloneProject"
.gitignore
.gitattributes
.githooks/pre-push
.github/pull_request_template.md
.github/CODEOWNERS
```

### Project repo

```
CAVES.json                 slug -> repo URL -> owner, for each member cave
shared/templates/          drawing templates shared across caves
shared/blocks/             symbol blocks
README.md
.gitignore
.gitattributes
.githooks/pre-push
.github/pull_request_template.md
.github/CODEOWNERS
```

### `.gitignore` (scaffolded verbatim, comments included)

```
# CaveCAD working files
*~
~*.dxf
*.dxf.bak

# macOS
.DS_Store

# Notebook and sketch scans are NOT tracked. GitHub hard-blocks any file over
# 100 MB and git-lfs is not in use in this project. Scans stay on local disk
# and in whatever backup covers the rest of the laptop. Do not un-ignore this
# without setting up git-lfs first.
scans/

# Transient export output
exports/tmp/
```

### `.gitattributes`

Explicit per-extension only — **no blanket `* text=auto`**, which would guess wrong the
first time a binary DXF lands in the repo and silently corrupt it on checkout.

```
*.dxf   text eol=lf
*.tsv   text eol=lf
*.dat   text eol=lf
*.svx   text eol=lf
*.log   text eol=lf
*.svg   text eol=lf
*.md    text eol=lf
*.json  text eol=lf
*.png   binary
*.jpg   binary
*.jpeg  binary
*.pdf   binary
```

### `CAVES.json`

```json
{
  "schema": 1,
  "project": "ozark-karst-project",
  "caves": [
    { "slug": "blowing-hole", "name": "Blowing Hole", "owner": "ndschonegg", "repo": "cave-blowing-hole" }
  ]
}
```

No coordinates, no county, no directions. The slug is the only identifier.

## New Core libraries

All pure JS, `Cs`-prefixed with the global matching the filename per
[[qcad-plugin-conventions]], each taking an **injectable process runner** so the unit
tests never spawn `git` or touch the network.

| File | Global | Owns |
|---|---|---|
| `Core/CsProc.js` | `CsProc` | The only place `QProcess` is constructed. `CsProc.run(prog, argv, opts)` -> `{code, out, err, timedOut}`. argv arrays exclusively — **never a shell string**, because cave names and macOS paths contain spaces and a shell string turns one argument into two. Per-call timeout. Appends every invocation and its exit code to `~/Library/Application Support/QCAD/CaveCAD/cave-git.log`. |
| `Core/CsGit.js` | `CsGit` | git verbs: `toplevel`, `status`, `currentBranch`, `defaultBranch`, `checkoutNew`, `add`, `commit`, `push`, `pullRebase`, `clone`, `aheadBehind`, `configLocal`. Pure argv builders separated from execution so they can be asserted in tests. |
| `Core/CsHub.js` | `CsHub` | `gh` verbs and their JSON: `authStatus`, `repoView`, `repoCreate`, `prCreate`, `prList`, `assertPrivate`, `currentLogin`. |
| `Core/CsSetup.js` | `CsSetup` | Executable discovery, the preflight ladder, the device-flow login state machine, git identity, and the platform-specific install links. |
| `Core/CsRepo.js` | `CsRepo` | Scaffold content generation and writing, `CAVE.json` / `CAVES.json` read+write, path -> cave slug resolution, session branch naming. |
| `Core/CsSidecar.js` | `CsSidecar` | Survey model -> deterministic TSV, and parse back for diffing. |
| `Core/CsCommitMsg.js` | `CsCommitMsg` | Revision-log delta (primary) plus sidecar diff (fallback and subject line) -> commit subject/body and PR title/body. |
| `Core/CsSync.js` | `CsSync` | The save-path orchestrator: resolve repo, ensure branch, write sidecar, stage, commit, push. Owns the offline queue state and the "git is unavailable this session" latch. |

`Core/CsAll.js` gains the new files in dependency order.

## New tools

Menu group stays `450`. Sort orders 22, 25, 27, 30, 32, 34 are free in the current suite
(used: 5, 10, 15, 20, 40, 52, 60, 70, 75, 78, 80, 85, 90, 95). Because a duplicate
`(groupSortOrder, sortOrder)` silently displaces a tool from the menu,
`make_package.sh` gains an assertion that every pair in the suite is unique.

| Tool | Sort | Does |
|---|---|---|
| `GitHubSetup/` | 22 | Runs the preflight ladder and the login flow. Also invoked automatically, once per session, the first time any other git tool runs. |
| `CloneProject/` | 25 | Pick a project or cave repo (`gh repo list` or typed `owner/name`), `assertPrivate`, clone into `~/Documents/Cave/<name>/`, set `core.hooksPath`, read `CAVES.json` and offer member caves, then offer to open a drawing. |
| `InitCaveRepo/` | 27 | Scaffold a cave or project repo on disk, `git init`, `gh repo create --private`, first commit, push, and register the cave in a project's `CAVES.json`. |
| `SyncProject/` | 30 | Explicit `git pull --rebase` then push. The only place a rebase is ever attempted. |
| `ProjectStatus/` | 32 | `QTreeWidget`: repo, branch, dirty files, ahead/behind, queued-push count, open PRs, and the same-cave overlap warning. |
| `OpenPullRequest/` | 34 | `QDialog`: editable title, generated body, base branch picker, then `gh pr create`. Reports the PR URL. |

No menu item for the save wrapper. `CaveSurvey.js`'s `init(basePath)` installs it.

## The save path

The wrapper wraps `Save.prototype.save` **at install time, by replacing the function on
the prototype** — the pattern `CsBind.withSuppressed` already uses, chosen for the same
reason: a call site that has to remember to opt in fails silently the day someone adds a
new caller. `Save` is a global loaded by QCAD's own include; the installer guards with a
`typeof Save === "undefined"` check before including it, because QCAD's `include()`
dedupes by basename and `Save.js` is certain to be already loaded.

Order, with each step's failure isolated:

1. **Stock save runs first, unmodified.** Its return value is what the wrapper returns.
   Git never delays, blocks, or fails a save. If step 1 returns false, the wrapper stops
   — there is nothing to commit.
2. **Resolve the repo.** `CsGit.toplevel(dirname(fileName))`. Not in a work tree, or the
   work tree has no `CAVE.json`/`CAVES.json`: return silently. A drawing outside a cave
   repo behaves exactly as it does today.
3. **Ensure the session branch.** If `HEAD` is the default branch, create
   `survey/2026-08-20-ndschonegg` from it. Handle unavailable already means already on a
   `survey/*` branch — stay there.
4. **Regenerate the sidecar.** `CsRevise.surveyFromDocument(doc)` -> `CsSidecar.write()`
   -> `survey/<slug>.shots.tsv`.
5. **Commit.** Stage the saved `.dxf` and the sidecar only — never `git add -A`, which
   would sweep up whatever else is in the tree. Nothing staged after the diff check
   means nothing changed: skip the commit entirely rather than making an empty one.
6. **Push.** `git push -u origin <branch>`, after `CsHub.assertPrivate`.

### Session branch, not Trip

`survey/YYYY-MM-DD-<gh-login>` is a **work session**, not the revision framework's Trip.
Trip identity is the fingerprint `date|declination|team` and one drawing may hold many
trips ([[cave-survey-revision-framework]]); one session branch can therefore carry
several trips, and several sessions can touch one trip. Naming the branch `trip/...`
would invite exactly the conflation that breaks `CsModel.ensureTrips`. The login comes
from `CsHub.currentLogin` and is sanitized to `[A-Za-z0-9._-]`.

## Sidecar format

`survey/<slug>.shots.tsv`. A **review artifact, not a backup** — the DXF remains the
source of truth and the only thing `CsRevise` reconstructs from. Its single job is to
make a changed azimuth show up as one changed line in a pull request.

```
# schema	1
# cave	blowing-hole
# geo	A1
# trip	1	2026-08-20	NS,JD	-2.50	igrf	ft
from	to	dist	az	inc	L	R	U	D	trip	flags	note
A1	A2	42.10	118.50	-3.00	2.00	3.00	1.00	0.00	1
A2	A3	17.55	094.00	12.50		5.00	2.00	0.00	1	X	tight crawl
```

Rules that make the diff readable, all of which are testable:

- **Order is `(tripId, shotSeq)` ascending.** Never document query order, which is not
  deterministic in this build.
- **Fixed decimal places** — distances and LRUD to 2, angles to 2. Unstable float
  formatting is what turns a one-shot edit into a 400-line diff, so determinism is the
  point of the file, not a nicety.
- **Empty field means not measured; `0.00` means a wall at the station.** The same
  null-versus-zero distinction the LRUD model already makes.
- **Tabs and newlines inside a note are escaped** as `\t` and `\n`. Note that this file
  is written by a different mechanism than `CsTags`, whose nested-escaping hazard
  (backslash-n inside a tag payload) does not apply here — but the sidecar writer must
  never be "unified" with `CsTags.set` for that reason.
- **`# geo <station>` records that a station is georeferenced and nothing more.** No
  latitude, no longitude, no `*fix` line.
- Azimuths are written as stored: TRUE, declination already applied, with the trip's
  declination and its source on the `# trip` line so a reviewer can see which correction
  produced them.

## Commit message and PR body

Commit subject stays under 72 characters, truncating the station range before the shot
count:

```
survey 2026-08-20: +14 shots, A7..A12

Cave: blowing-hole
Trips: 2026-08-20 (NS, JD)
Shots: 14 added, 2 revised
Closure: L1 4.21 ft -> 0.74 ft
Drawing: drawings/blowing-hole.dxf
```

PR body is the same summary under the template's checklist. `CsCommitMsg` computes it by
diffing the previous sidecar in `HEAD` against the regenerated one, plus `CsStats` for
closure and grade — which is why this logic cannot live in a shell script: it needs the
survey model in process.

`.github/pull_request_template.md`:

```
## Trip summary

<!-- filled in by CaveCAD -->

## Checks

- [ ] Declination source recorded for every trip
- [ ] Loop closure acceptable, or the misclosure is explained
- [ ] Blunder check clean
- [ ] No coordinates on the map face or in the title block
```

`.github/CODEOWNERS` routes each cave folder to its owner so the one-cave-each convention
is enforced by review assignment rather than by memory.

## The revision log is the message

`RevisionLog` landed in `0.2.7.1` on the revision-framework side: an append-only,
newline-joined text property in the `CaveSurvey` group, on the trip-0 anchor station
(falling back to the lowest-numbered trip anchor on older drawings), written by both
revision paths through `CsRevise.appendLog`. Integration notes for this design are in
`2026-08-21-revisionlog-versioning-notes.md`; the four calls they left open are settled
here.

Nothing in the suite is released — the version scheme went pre-1.0 (`0.MAJOR.MINOR.PATCH`)
for exactly that reason, and the revision framework has had no GUI pass. So "landed in
`0.2.7.1`" means present in the tree and headless-tested, **not** proven in a real window.
This design depends on `CsRevise.surveyFromDocument` and `RevisionLog` being correct at
runtime, so a GUI pass on the revision framework is a prerequisite for slice 2, not a
parallel task.

It carries no timestamps, deliberately — this codebase avoids `Date` for test
determinism. That composes rather than conflicts: **git supplies the time, the log
supplies the meaning.**

**1. The commit body is the log delta.** `CsCommitMsg` reads `RevisionLog`, diffs it
against the value recorded at the previous commit, and uses the new lines as the body.
This replaces generating prose from a sidecar diff, which would have been a worse
paraphrase of something the drawing already says in the surveyor's own terms. The sidecar
diff still supplies the subject line's counts.

A save with **no new log lines** is a geometry-only edit — hand-traced walls, sheet
furniture, a moved label. The body says exactly that rather than inventing a description
of a revision that did not happen.

**2. The PR body is the same source over a wider window** — the lines added since the
branch point. "A trip becomes a reviewable unit carrying its own survey summary" then
requires no generation at all.

**3. It exports to `survey/<slug>.revisions.log`, verbatim.** XDATA is invisible on
github.com, which defeats the purpose of putting review on GitHub; an append-only text
file diffs as added lines rather than a rewrite, which is exactly what a reviewer wants.
It is also the one artifact a DXF diff can never show usefully, because a revision rotates
every coordinate in the file.

**Team names are included (decision 9).** The names are already on the survey sheets, in
the trip reports, and in the DXF, and decision 1 keeps the repo private with a
fail-closed hook. The argument considered and rejected: a collaborator added years later
reads the whole who-caved-with-whom history retroactively, since private means
scoped-to-whoever-has-access-in-future, not scoped-to-today's-team. Judged proportionate
for this team. **Note the asymmetry with coordinates deliberately:** the sidecar still
omits lat/lon. Names are recoverable social information; an entrance location is not
recoverable once it is out.

### Two hazards about reading the log

**Stock QCAD drops it.** The log survives as real DXF XDATA only through the CaveCAD
fork's writer. A drawing opened and saved in stock QCAD loses it silently, as it loses
every other tag. So a **gap in the log means someone saved elsewhere, not that nothing
happened** — no versioning logic may treat the log as a complete history, and a commit
whose log delta is empty must never be described as "no survey change" with any
confidence beyond "this drawing does not record one."

**Drawings predating `0.2.7.1` may have truncated logs**, because every Draw used to
destroy the log. A short log is not evidence of a short history.

## Conflicts, offline, and errors

**Nothing is ever text-merged.** Both the `.dxf` and the sidecar are regenerated wholes,
so handing them to git's merge driver could only produce a corrupt drawing.
`.gitattributes` does not define a merge driver for them, and `SyncProject` offers
keep-mine / keep-theirs / stop on divergence. Regenerating the sidecar from the DXF is
always correct; merging two sidecars never is.

**A rejected push is reported, never resolved on the save path.** Non-fast-forward means
someone else has commits. Rebasing underneath a surveyor who is mid-drawing is how work
gets lost, so the save path reports and stops; `SyncProject` is where the surveyor
chooses to rebase, deliberately.

**Offline is a normal state, not an error.** Push failure that looks like a network
problem (unresolved host, timeout) leaves the commits local, increments a queued count,
writes one quiet line to the command line — no dialog — and retries on the next save.
`ProjectStatus` shows the ahead count so the queue is never invisible.

**Broken `gh` auth latches.** `gh auth status` failing produces one clear message
pointing at `gh auth login`, then sets a session latch that keeps git features quiet
until CaveCAD restarts. Warning on every save would train the surveyor to ignore
warnings.

**Every failure surfaces the shortest decisive line** from stderr, with the full output
in `cave-git.log`. Timeouts: 30 s default, 300 s for clone, with `QProgressDialog` for
clone only — the save path must never show a modal.

**Overlap warning** comes from `gh pr list --state open --json number,author,headRefName,files`,
filtered to PRs touching this cave's paths, falling back to `gh api repos/{o}/{r}/pulls`
plus per-PR files if `files` is not populated on list. Shown by `ProjectStatus` and on
the first push of a session.

## Testing

Unit tests in the existing headless harness (`tests/run_all.sh`, runs under node and
`CaveCAD -no-gui`), with `CsProc` replaced by a fake runner throughout:

- **Scaffold content** — exact expected bytes for `.gitignore`, `.gitattributes`,
  `pre-push`, the PR template, `CAVE.json`, `CAVES.json`.
- **Sidecar determinism** — the same survey serialized twice is byte-identical; a survey
  whose shots arrive in a different order serializes identically; null LRUD stays empty
  and zero stays `0.00`; a note containing a tab and a newline round-trips.
- **Sidecar omits coordinates** — an assertion that a survey with a georeferenced,
  `*fix`-carrying station produces output containing no latitude or longitude value.
  This one guards the project's first rule and should fail loudly if anyone "improves"
  the writer.
- **Commit message and PR body** from fixture sidecar pairs, including the 72-character
  subject truncation.
- **argv assertions on every builder** in `CsGit` and `CsHub` — exact arrays. This is
  what catches a cave name with a space becoming two arguments, the failure mode a
  shell-string implementation would ship with.
- **`gh` JSON parsing** against captured fixture responses for `repo view`, `pr list`,
  `auth status`, including a public-visibility response that must abort.
- **Branch naming** — sanitization of logins and dates.
- **Setup ladder** — executable resolution picks the first existing candidate and ignores
  a cached path that no longer resolves; install-link text is correct for each of `osx`,
  `win`, `linux`; the device-code regex extracts `XXXX-XXXX` from captured gh output on
  **either** stream; scope parsing correctly rejects an `auth status` fixture whose token
  lacks `repo`; the noreply email is built as `<id>+<login>@users.noreply.github.com`.
- **Revision-log delta** — new lines are extracted against a recorded previous value;
  an unchanged log yields an empty delta and the geometry-only-edit body; a log that
  SHRANK (the pre-`0.2.7.1` truncation case) is reported rather than diffed as if lines were
  deliberately removed.
- **Log export** — byte-identical across two runs, append-only relative to the previous
  export, and team names present verbatim per decision 9.
- **Token redaction** — `CsProc`'s log writer, given a line containing `ghp_`, `gho_`,
  `ghu_` or `ghs_` followed by token characters, emits a redacted line. Asserted with a
  synthetic string, never a real token. This test is the reason the log is safe to attach
  to a bug report.

One integration test, real `git`, no network and no `gh`: create a temp dir, `git init
--bare` a remote, clone it through `CsGit`, scaffold, commit, push, and verify the bare
repo received the objects. `CsHub` stays faked because it is the network.

`make_package.sh` gains the sort-order uniqueness assertion.

### Verification status as of 2026-08-21 (slice 1)

**Item 4 — PARTIALLY verified, by proxy, not by a Finder launch.** Running CaveCAD
under a stripped environment (`env -i HOME=$HOME`, the closest approximation to what
launchd hands a Finder-launched app) reproduces the bug the candidate ladder exists to
prevent: `PATH` comes back as `/usr/gnu/bin:/usr/local/bin:/bin:/usr/bin:.` with no
`/opt/homebrew/bin`, a bare `gh` fails with `execve: No such file or directory`, and the
absolute path works. Discovery via absolute candidates is therefore confirmed necessary
and sufficient under that environment. A real `open -a CaveCAD` launch has NOT been done.

Note the stripped `PATH` still contains `/usr/local/bin`, so this bug bites Apple Silicon
Homebrew and would silently fail to reproduce on an Intel Mac.

**Also verified headlessly:** the full `discoverTools` -> `probe` -> `ladder` chain run
inside CaveCAD's own engine against this machine returns all six rungs green, matching the
real `gh auth status` and `git config` state checked independently in the shell.

**Item 1 belongs to slice 2** — there is no save wrapper yet.

### Needs live GUI verification (cannot be proven headless)

1. The `Save.prototype.save` wrapper actually fires on File > Save, on Ctrl+S, and on
   Save All — and does **not** fire on AutoSave.
2. The device-flow dialog renders, the code is legible, `QDesktopServices.openUrl` opens
   the browser, and Cancel actually kills the `gh` child process rather than orphaning it.
3. The token-fallback field masks its input, and the token never appears in
   `cave-git.log` after a real login.
4. `gh` resolution works in a CaveCAD launched **from Finder**, not just from a terminal
   — the case the original probe could not see.
5. `OpenPullRequest`'s `QDialog` renders and its widgets connect under the brew bridge.
6. `ProjectStatus`'s `QTreeWidget` populates.
7. The offline queue behaves with the network actually off.
8. Push latency on a real save is tolerable in normal use.

## Not in scope

- **Any public repo path, and any coordinate fuzzing.** Decision 1 removes the need;
  [[cave-location-privacy]] already rejected fuzzing on its own merits.
- **A CI workflow validating the sidecar.** Considered and dropped — the Core libs would
  have to run in CI without CaveCAD, and the checks already run in-app before the commit.
- **Committed PDF or PNG plot exports.** Binary churn without git-lfs.
- **Merge tooling for two people editing one drawing.** Decision 6: one cave each, warn
  on overlap.
- **git-lfs setup and tracked `scans/`.** Decision 7.
- **Submodules.** `CAVES.json` is a plain manifest; on-demand cloning is simpler than
  submodule state and does not need the surveyor to understand detached HEAD.
- **Sanitized-copy export.** Still the right feature if a DXF ever has to leave the
  project, still not needed here, still low priority.

Companion: `docs/superpowers/specs/2026-08-21-revisionlog-versioning-notes.md`.

See [[qcad-plugin-conventions]], [[cave-location-privacy]],
[[cave-survey-revision-framework]], [[qcad-publish-to-cave]].
