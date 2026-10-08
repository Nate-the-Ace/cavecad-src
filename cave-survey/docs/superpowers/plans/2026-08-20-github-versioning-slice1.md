# GitHub Versioning, Slice 1: Plumbing and Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new surveyor can install `git` and `gh`, log into GitHub, and end up with a working credential helper and git identity — entirely from inside CaveCAD.

**Architecture:** Four new pure-JS Core libraries and one tool. `CsProc` is the only place `QProcess` is ever constructed, and it takes an injectable backend so every layer above it is testable under node with no subprocess and no network. `CsGit` and `CsHub` separate **argv builders** (pure, returning arrays) from execution, because argv arrays are the whole defence against a cave name with a space becoming two arguments. `CsSetup` is a six-rung preflight ladder over those, each rung returning a state object with its own remedy text. `GitHubSetup` is the only GUI.

**Tech Stack:** QCAD/CaveCAD ECMAScript add-on API (Community only, nothing Pro), `QProcess`, `QDialog`/`QLabel`/`QLineEdit`/`QPushButton`, `QDesktopServices`, `RSettings`; `git` and `gh` CLIs; tests in `tests/js_unit.js` (runs under both CaveCAD's engine and node) and `tests/test_addon.py`.

**User decisions (already made):**
- "Private-only, hard enforced" — non-private repos refused, no override. The `repo` scope check exists because a token without it makes a private repo 404 rather than 403.
- "Auto-push after every save" — so the setup ladder must never show a modal on the save path; it runs once per session and latches.
- Onboarding is part of the feature, not a prerequisite: detect missing `git`/`gh`, give platform install links, drive the login.
- Device flow is primary; token paste is the fallback. No secret passes through the plugin on the primary path.
- HTTPS throughout (`--git-protocol https`). SSH keys, GitHub Enterprise, and SAML SSO are out of scope.

**Spec:** `docs/superpowers/specs/2026-08-20-github-versioning-design.md` — sections "Onboarding a new user", "New Core libraries", "New tools".

**Branch:** work on `github-versioning`, not `v2`. A second session has been committing to `v2` throughout this design; staying off it avoids interleaving.

---

## Ground rules for every task

**No Core file may reference `QProcess`, `QFile`, `RSettings`, or any `Q*`/`R*` global at load time.** `tests/js_unit.js` evaluates each Core file under node, where those do not exist. Construct them inside function bodies only, guarded by `typeof`. A top-level reference turns the whole unit suite red with a `ReferenceError` that names the wrong culprit.

**Every new Core file is `Cs`-prefixed and its global matches its filename.** `tests/test_addon.py::TestBasenameCollisions::test_core_files_are_cs_prefixed` enforces it. CaveCAD's `include()` dedupes by basename, so an unprefixed `Proc.js` could be silently skipped in the GUI while every headless test passes.

**Tests append to `tests/js_unit.js`** in the existing style — a `// ---` banner comment, then bare `ok(...)`/`near(...)` calls at top level. There is no test-function registry. New Core files must also be added to that file's `CORE_FILES` array in dependency order.

**Fixtures for anything an external tool prints MUST be captured from that tool, never
composed.** This rule was learned the hard way twice in this slice. The `parsePorcelain`
fixtures below were written from what `git status --porcelain` output looks like from
memory — unquoted spaced paths — and git has never emitted that: it C-quotes ANY path
containing a space, so the parser passed its tests while returning a path `git add` would
reject. Task 1 had the same shape with a Qt API that does not exist in this engine. A test
built on an invented fixture passes while the feature is broken.

So, before writing a parser test: run the real tool in a throwaway directory (under the
scratchpad, never inside the worktree), capture its actual bytes, and paste those. Verify
with `xxd` if quoting or encoding is involved. This applies to every fixture in this plan,
including the `AUTH_OK` / `AUTH_THIN` `gh auth status` strings in Task 3 — those were
written from memory too and MUST be re-captured from a real `gh auth status` before being
trusted. The Task 5 device-flow fixture is the one exception already known-good: it came
from a live probe on 2026-08-20 and its provenance is recorded in the test comment.

Likewise, **verify any API you have not seen used elsewhere in this repo actually exists**
before relying on it, rather than trusting this plan's code blocks. They were written
against the QCAD API as documented, and this bridge diverges.

**Validate with `typeof`, never with truthiness plus `String()`.** This produced the
worst defect in the slice: `CsHub.parseVisibility` used `String(j.visibility)`, so
`{"visibility":["PRIVATE"]}` returned `true` from `isPrivate` — the gate carrying "never
expose a cave entrance" said yes to a non-private shape, because `String(["PRIVATE"])` is
`"PRIVATE"`. The same pattern threw a `TypeError` on `{"visibility":{"toString":1}}`, and
in `noreplyEmail` it let `1e21` become a committer address in permanent history. Note also
that `Math.floor(n) === n` does NOT prove an integer for large doubles — nothing past 2^52
has a fractional part — so a range cap is needed too.

Guard every field a parser reads with `typeof x === "string"` / `=== "number"` and an
explicit range check. And when a docstring promises "never throws" or "never returns true
unless...", make it literally true: later tasks get written trusting it.

**Run after every task:** `./tests/run_all.sh` — expect `ALL TESTS PASSED (publish checks not run; use --publish)`.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/CaveSurvey/Core/CsProc.js` (create) | The only `QProcess` construction site. Runs an argv array, returns `{code, out, err, timedOut}`. Owns log writing and token redaction. |
| `scripts/CaveSurvey/Core/CsGit.js` (create) | git argv builders and the parsers for their output. No GUI, no gh. |
| `scripts/CaveSurvey/Core/CsHub.js` (create) | `gh` argv builders, JSON parsing, `assertPrivate`, scope checking. |
| `scripts/CaveSurvey/Core/CsSetup.js` (create) | Executable discovery, install help per platform, the six-rung ladder, device-code parsing, git identity. |
| `scripts/CaveSurvey/GitHubSetup/GitHubSetup.js` (create) | The tool: ladder display, device-flow dialog, token fallback. |
| `scripts/CaveSurvey/GitHubSetup/GitHubSetup.svg` (create) | Toolbar icon. Required by `test_referenced_icons_exist`, and by `--publish` for parseable SVG. |
| `scripts/CaveSurvey/Core/CsAll.js` (modify) | Add the four includes in dependency order. |
| `tests/js_unit.js` (modify) | Add the four files to `CORE_FILES`; append test sections. |
| `tests/test_addon.py` (modify) | Add the sort-order-uniqueness assertion the spec calls for — it already exists as `test_sort_orders_are_unique`, so verify rather than duplicate. |

Dependency order: `CsProc` → `CsGit`, `CsHub` → `CsSetup` → `GitHubSetup`.

---

### Task 1: CsProc — the one process runner

**Goal:** A process runner that takes an argv array, never a shell string, with an injectable backend so everything above it is testable under node, and which redacts tokens from its log.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsProc.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsProc.run("git", ["--version"])` returns `{code, out, err, timedOut}`.
- [ ] `CsProc.setBackend(fn)` replaces execution; the fake receives the program and the argv array unmodified, including arguments containing spaces.
- [ ] `CsProc.redact` replaces `ghp_`, `gho_`, `ghu_`, `ghs_` tokens with `<redacted>`.
- [ ] The file evaluates under node with no `ReferenceError` — no `Q*` reference outside a function body.
- [ ] `timedOut` is true when the backend reports a timeout, and `code` is non-zero in that case.

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing tests** — append to `tests/js_unit.js` before the final `// Report.` banner

```js
// ---------------------------------------------------------------------
// CsProc -- argv discipline, redaction, injectable backend.
// ---------------------------------------------------------------------

var procCalls = [];
CsProc.setBackend(function(prog, argv, opts) {
    procCalls.push({ prog: prog, argv: argv, opts: opts });
    return { code: 0, out: "fake-out", err: "", timedOut: false };
});

var pr = CsProc.run("git", ["commit", "-m", "two words"]);
ok(pr.code === 0, "CsProc.run returns the backend's code");
ok(pr.out === "fake-out", "CsProc.run returns stdout");
ok(pr.timedOut === false, "CsProc.run reports no timeout");
ok(procCalls.length === 1, "CsProc.run called the backend once");
ok(procCalls[0].prog === "git", "CsProc passes the program through");
ok(procCalls[0].argv.length === 3, "CsProc passes 3 arguments, not a joined string");
ok(procCalls[0].argv[2] === "two words",
    "CsProc keeps a spaced argument as ONE argument");

// A timeout must not look like success.
CsProc.setBackend(function() {
    return { code: -1, out: "", err: "timed out", timedOut: true };
});
var pt = CsProc.run("git", ["fetch"]);
ok(pt.timedOut === true, "CsProc surfaces timedOut");
ok(pt.code !== 0, "a timeout is a non-zero code");

// Redaction. Synthetic strings only -- never a real token in a test.
ok(CsProc.redact("Token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345")
        .indexOf("ghp_ABCDEF") === -1,
    "CsProc.redact removes a ghp_ token");
ok(CsProc.redact("gho_0123456789abcdefghijklmnopqrstuvwx")
        .indexOf("<redacted>") !== -1,
    "CsProc.redact marks a gho_ token");
ok(CsProc.redact("ghu_AAA ghs_BBB").indexOf("ghu_AAA") === -1 &&
   CsProc.redact("ghu_AAA ghs_BBB").indexOf("ghs_BBB") === -1,
    "CsProc.redact removes ghu_ and ghs_ tokens");
ok(CsProc.redact("no secret here") === "no secret here",
    "CsProc.redact leaves ordinary text alone");
ok(CsProc.redact(null) === "", "CsProc.redact tolerates null");

CsProc.setBackend(null);   // restore the real backend for later sections
```

- [ ] **Step 2: Add the file to the harness load list** — in `tests/js_unit.js`, add to `CORE_FILES` immediately after `"scripts/CaveSurvey/Core/CsUnits.js"`

```js
    "scripts/CaveSurvey/Core/CsProc.js",
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `./tests/run_all.sh 2>&1 | tail -20`
Expected: FAIL — `cannot open .../Core/CsProc.js` from `loadRepoScript`, because the file does not exist yet.

- [ ] **Step 4: Write CsProc.js**

```js
// CsProc.js -- the ONE place a child process is started.
//
// Everything that shells out (git, gh) goes through here, for three
// reasons:
//
//   1. ARGV ARRAYS, NEVER A SHELL STRING. Cave names and macOS paths
//      contain spaces; a shell string turns one argument into two and
//      the failure is a confusing git error, not a syntax error.
//   2. An INJECTABLE BACKEND, so every layer above this file is
//      testable under node with no subprocess and no network.
//   3. REDACTION. The log is meant to be safe to attach to a bug
//      report, so a token must never reach it.
//
// QProcess is constructed INSIDE the backend only. tests/js_unit.js
// evaluates this file under node, where QProcess does not exist -- a
// top-level reference would fail the entire unit suite.

function CsProc() {
}

CsProc.DEFAULT_TIMEOUT_MS = 30000;

// Injected by tests. Null means "use the real QProcess backend".
CsProc.backend = null;

CsProc.setBackend = function(fn) {
    CsProc.backend = fn;
};

// Token shapes GitHub issues. Kept broad on purpose: a new prefix is
// cheaper to add than a leaked token is to undo.
CsProc.TOKEN_RE = /gh[pousr]_[A-Za-z0-9_]{8,}/g;

CsProc.redact = function(text) {
    if (text === null || text === undefined) {
        return "";
    }
    return String(text).replace(CsProc.TOKEN_RE, "<redacted>");
};

CsProc.logPath = function() {
    // Beside QCAD's own settings, not in the repo -- a log inside a
    // cave repo would get committed and pushed by the save path.
    if (typeof RSettings === "undefined") {
        return null;
    }
    try {
        return RSettings.getStandardWritableLocation() + "/cave-git.log";
    } catch (e) {
        return null;
    }
};

CsProc.log = function(line) {
    var path = CsProc.logPath();
    if (path === null || typeof QFile === "undefined") {
        return;
    }
    try {
        var f = new QFile(path);
        if (f.open(new QIODevice.OpenMode(QIODevice.WriteOnly | QIODevice.Append |
                                         QIODevice.Text))) {
            var s = new QTextStream(f);
            s.writeString(CsProc.redact(line) + "\n");
            f.close();
        }
    } catch (e) {
        // A log that cannot be written must never break the operation
        // it was describing.
    }
};

// The real backend. Only reached when no fake is installed.
CsProc.qprocessBackend = function(prog, argv, opts) {
    var timeout = (opts && opts.timeoutMs) ? opts.timeoutMs : CsProc.DEFAULT_TIMEOUT_MS;
    var p = new QProcess();
    var out = "";
    var err = "";
    var timedOut = false;
    var code = -1;
    try {
        p.start(prog, argv);
        if (opts && typeof opts.stdin === "string" && opts.stdin.length > 0) {
            // Secrets arrive this way and NOWHERE else -- never as an
            // argument, where ps would show them.
            p.write(new QByteArray(opts.stdin));
            p.closeWriteChannel();
        }
        if (!p.waitForFinished(timeout)) {
            timedOut = true;
            try { p.kill(); } catch (e2) {}
        }
        out = new QTextStream(p.readAllStandardOutput()).readAll();
        err = new QTextStream(p.readAllStandardError()).readAll();
        code = timedOut ? -1 : p.exitCode();
    } catch (e) {
        err = String(e);
        code = -1;
    }
    return { code: code, out: out, err: err, timedOut: timedOut };
};

/**
 * Runs prog with argv and returns {code, out, err, timedOut}.
 *
 * opts.timeoutMs  -- default CsProc.DEFAULT_TIMEOUT_MS
 * opts.stdin      -- written to the child's stdin, then the channel is
 *                    closed. The ONLY route for a token.
 */
CsProc.run = function(prog, argv, opts) {
    if (!argv) {
        argv = [];
    }
    var backend = CsProc.backend;
    if (backend === null || backend === undefined) {
        backend = CsProc.qprocessBackend;
    }
    var r = backend(prog, argv, opts || {});
    if (r.timedOut && r.code === 0) {
        // A backend that reports both is contradicting itself; a
        // timeout is never a success.
        r.code = -1;
    }
    // Never log opts.stdin, and never log argv verbatim without
    // redaction -- a caller could still have put a token in a flag.
    CsProc.log("$ " + prog + " " + argv.join(" ") + "  -> " + r.code);
    return r;
};
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `./tests/run_all.sh 2>&1 | tail -6`
Expected: `ALL TESTS PASSED (publish checks not run; use --publish)`, with the assertion count higher than before by 14.

- [ ] **Step 6: Add to CsAll.js** — after the `CsUnits.js` include

```js
include(includeBasePath + "/CsProc.js");
```

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsProc.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: CsProc, the one process runner -- argv arrays and redaction"
```

---

### Task 2: CsGit — argv builders and output parsers

**Goal:** Every git command this feature needs, as a pure argv builder plus a parser for its output, with no GUI and no knowledge of `gh`.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsGit.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsGit.argvCommit("msg with spaces")` returns `["commit", "-m", "msg with spaces"]` — three elements.
- [ ] `CsGit.parseToplevel` trims the trailing newline git emits and returns null on non-zero exit.
- [ ] `CsGit.parsePorcelain` turns `git status --porcelain` output into `{path, code}` records, handling a renamed path and a path containing a space.
- [ ] `CsGit.parseAheadBehind` reads `rev-list --count --left-right` output into `{ahead, behind}`.
- [ ] Every builder is exercised by an exact-array assertion.

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing tests** — append to `tests/js_unit.js`

```js
// ---------------------------------------------------------------------
// CsGit -- argv builders (exact arrays) and output parsers.
// ---------------------------------------------------------------------

function sameArgv(got, want, what) {
    var equal = (got.length === want.length);
    if (equal) {
        for (var i = 0; i < want.length; i++) {
            if (got[i] !== want[i]) {
                equal = false;
                break;
            }
        }
    }
    ok(equal, what + " (got [" + got.join("|") + "], want [" + want.join("|") + "])");
}

sameArgv(CsGit.argvToplevel(), ["rev-parse", "--show-toplevel"], "argvToplevel");
sameArgv(CsGit.argvStatus(), ["status", "--porcelain"], "argvStatus");
sameArgv(CsGit.argvCurrentBranch(), ["rev-parse", "--abbrev-ref", "HEAD"],
    "argvCurrentBranch");
sameArgv(CsGit.argvCommit("msg with spaces"),
    ["commit", "-m", "msg with spaces"],
    "argvCommit keeps the message as ONE argument");
sameArgv(CsGit.argvAdd(["drawings/Blowing Hole.dxf", "survey/bh.shots.tsv"]),
    ["add", "--", "drawings/Blowing Hole.dxf", "survey/bh.shots.tsv"],
    "argvAdd separates paths with -- and keeps spaces intact");
sameArgv(CsGit.argvCheckoutNew("survey/2026-08-20-nd", "main"),
    ["checkout", "-b", "survey/2026-08-20-nd", "main"], "argvCheckoutNew");
sameArgv(CsGit.argvPush("origin", "survey/2026-08-20-nd"),
    ["push", "-u", "origin", "survey/2026-08-20-nd"], "argvPush");
sameArgv(CsGit.argvClone("https://github.com/o/r.git", "/Users/n/Documents/Cave/r"),
    ["clone", "https://github.com/o/r.git", "/Users/n/Documents/Cave/r"],
    "argvClone");
sameArgv(CsGit.argvConfigSet("user.email", "1+n@users.noreply.github.com", false),
    ["config", "user.email", "1+n@users.noreply.github.com"],
    "argvConfigSet local omits --global");
sameArgv(CsGit.argvConfigSet("user.email", "1+n@users.noreply.github.com", true),
    ["config", "--global", "user.email", "1+n@users.noreply.github.com"],
    "argvConfigSet global includes --global");
sameArgv(CsGit.argvAheadBehind("origin/main", "HEAD"),
    ["rev-list", "--count", "--left-right", "origin/main...HEAD"],
    "argvAheadBehind");
sameArgv(CsGit.argvHooksPath(".githooks"),
    ["config", "core.hooksPath", ".githooks"], "argvHooksPath");

ok(CsGit.parseToplevel({ code: 0, out: "/Users/n/Documents/Cave/bh\n", err: "" }) ===
    "/Users/n/Documents/Cave/bh", "parseToplevel trims the newline");
ok(CsGit.parseToplevel({ code: 128, out: "", err: "not a git repository" }) === null,
    "parseToplevel returns null outside a work tree");

var st = CsGit.parsePorcelain({ code: 0, out:
    " M drawings/Blowing Hole.dxf\n?? survey/bh.shots.tsv\nA  notes/trip.md\n", err: "" });
ok(st.length === 3, "parsePorcelain finds 3 entries");
ok(st[0].path === "drawings/Blowing Hole.dxf",
    "parsePorcelain keeps a path containing a space");
ok(st[0].code === "M", "parsePorcelain reads the status code");
ok(st[1].code === "??", "parsePorcelain reads an untracked marker");
ok(CsGit.parsePorcelain({ code: 0, out: "", err: "" }).length === 0,
    "parsePorcelain on a clean tree is empty");

var ab = CsGit.parseAheadBehind({ code: 0, out: "2\t5\n", err: "" });
ok(ab.behind === 2 && ab.ahead === 5, "parseAheadBehind reads left-right counts");
ok(CsGit.parseAheadBehind({ code: 1, out: "", err: "no upstream" }) === null,
    "parseAheadBehind returns null with no upstream");

ok(CsGit.isNetworkFailure("fatal: unable to access 'https://github.com/': " +
    "Could not resolve host: github.com") === true,
    "isNetworkFailure spots an unresolved host");
ok(CsGit.isNetworkFailure("! [rejected]        main -> main (fetch first)") === false,
    "isNetworkFailure does not claim a rejected push");
ok(CsGit.isRejected("! [rejected]        main -> main (fetch first)") === true,
    "isRejected spots a non-fast-forward");
```

- [ ] **Step 2: Add to `CORE_FILES`** — after `CsProc.js`

```js
    "scripts/CaveSurvey/Core/CsGit.js",
```

- [ ] **Step 3: Run to verify failure**

Run: `./tests/run_all.sh 2>&1 | tail -20`
Expected: FAIL — `cannot open .../Core/CsGit.js`.

- [ ] **Step 4: Write CsGit.js**

```js
// CsGit.js -- git, as argv builders plus parsers for what git prints.
//
// The builders are PURE and return arrays, and the tests assert those
// arrays exactly. That is the design's defence against the bug a shell
// string would ship with: "drawings/Blowing Hole.dxf" must stay one
// argument. Execution goes through CsProc, which is injectable, so
// none of this needs git installed to test.

function CsGit() {
}

CsGit.argvToplevel = function() {
    return ["rev-parse", "--show-toplevel"];
};

CsGit.argvStatus = function() {
    return ["status", "--porcelain"];
};

CsGit.argvCurrentBranch = function() {
    return ["rev-parse", "--abbrev-ref", "HEAD"];
};

CsGit.argvCommit = function(message) {
    return ["commit", "-m", message];
};

CsGit.argvAdd = function(paths) {
    // "--" so a path that looks like a flag is still a path.
    return ["add", "--"].concat(paths);
};

CsGit.argvCheckoutNew = function(branch, from) {
    var a = ["checkout", "-b", branch];
    if (from) {
        a.push(from);
    }
    return a;
};

CsGit.argvPush = function(remote, branch) {
    return ["push", "-u", remote, branch];
};

CsGit.argvPullRebase = function() {
    return ["pull", "--rebase"];
};

CsGit.argvClone = function(url, dir) {
    return ["clone", url, dir];
};

CsGit.argvConfigGet = function(key) {
    return ["config", "--get", key];
};

CsGit.argvConfigSet = function(key, value, global) {
    var a = ["config"];
    if (global) {
        a.push("--global");
    }
    a.push(key);
    a.push(value);
    return a;
};

CsGit.argvAheadBehind = function(upstream, head) {
    return ["rev-list", "--count", "--left-right", upstream + "..." + head];
};

CsGit.argvHooksPath = function(path) {
    return ["config", "core.hooksPath", path];
};

CsGit.argvVersion = function() {
    return ["--version"];
};

CsGit.parseToplevel = function(r) {
    if (!r || r.code !== 0) {
        return null;
    }
    var s = String(r.out).replace(/[\r\n]+$/, "");
    return s.length > 0 ? s : null;
};

CsGit.parsePorcelain = function(r) {
    var entries = [];
    if (!r || r.code !== 0) {
        return entries;
    }
    var lines = String(r.out).split("\n");
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.length < 4) {
            continue;
        }
        // Porcelain v1: two status characters, a space, then the path.
        // The path may contain spaces, so split ONCE at column 3.
        var code = line.substring(0, 2).replace(/ /g, "");
        var path = line.substring(3);
        entries.push({ code: code, path: path });
    }
    return entries;
};

CsGit.parseAheadBehind = function(r) {
    if (!r || r.code !== 0) {
        return null;
    }
    var m = String(r.out).match(/(\d+)\s+(\d+)/);
    if (m === null) {
        return null;
    }
    // --left-right with upstream...HEAD: left is upstream-only
    // (commits we do not have = behind), right is ours (ahead).
    return { behind: parseInt(m[1], 10), ahead: parseInt(m[2], 10) };
};

CsGit.isNetworkFailure = function(text) {
    var s = String(text === null || text === undefined ? "" : text);
    return /could not resolve host|unable to access|connection (timed out|refused)|network is unreachable|operation timed out/i.test(s);
};

CsGit.isRejected = function(text) {
    var s = String(text === null || text === undefined ? "" : text);
    return /\[rejected\]|non-fast-forward|fetch first/i.test(s);
};
```

- [ ] **Step 5: Run to verify pass**

Run: `./tests/run_all.sh 2>&1 | tail -6`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 6: Add to CsAll.js** — after the `CsProc.js` include

```js
include(includeBasePath + "/CsGit.js");
```

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsGit.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: CsGit -- git argv builders and output parsers"
```

---

### Task 3: CsHub — gh argv, JSON parsing, and assertPrivate

**Goal:** The `gh` layer, including the two checks that carry the privacy decision: a repo must be `PRIVATE`, and the token must carry the `repo` scope.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsHub.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsHub.parseVisibility` accepts `PRIVATE` and rejects `PUBLIC` and `INTERNAL`.
- [ ] `CsHub.isPrivate` returns false — never true — when the `gh` call failed, so an unverifiable repo is treated as unsafe.
- [ ] `CsHub.parseScopes` extracts scopes from real `gh auth status` output shape, and `CsHub.hasRepoScope` is false when `repo` is absent.
- [ ] `CsHub.parseLogin` extracts the active account login.
- [ ] Every argv builder asserted as an exact array.

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing tests** — append to `tests/js_unit.js`

```js
// ---------------------------------------------------------------------
// CsHub -- gh argv, JSON parsing, and the two privacy gates.
// ---------------------------------------------------------------------

sameArgv(CsHub.argvRepoView("ndschonegg/cave-blowing-hole"),
    ["repo", "view", "ndschonegg/cave-blowing-hole", "--json",
     "visibility,nameWithOwner,defaultBranchRef"],
    "argvRepoView");
sameArgv(CsHub.argvAuthStatus(), ["auth", "status"], "argvAuthStatus");
sameArgv(CsHub.argvRepoCreate("cave-blowing-hole"),
    ["repo", "create", "cave-blowing-hole", "--private"], "argvRepoCreate");
sameArgv(CsHub.argvSetupGit(), ["auth", "setup-git"], "argvSetupGit");
sameArgv(CsHub.argvRefreshScope("repo"), ["auth", "refresh", "-s", "repo"],
    "argvRefreshScope");
sameArgv(CsHub.argvDeviceLogin(),
    ["auth", "login", "--web", "--git-protocol", "https",
     "--hostname", "github.com", "--scopes", "repo,read:org",
     "--clipboard", "--skip-ssh-key"],
    "argvDeviceLogin");
sameArgv(CsHub.argvTokenLogin(),
    ["auth", "login", "--with-token", "--git-protocol", "https",
     "--hostname", "github.com"],
    "argvTokenLogin");
sameArgv(CsHub.argvApiUser(), ["api", "user"], "argvApiUser");

// Visibility. PRIVATE only -- decision 1, no override.
ok(CsHub.parseVisibility({ code: 0, out: '{"visibility":"PRIVATE"}', err: "" }) ===
    "PRIVATE", "parseVisibility reads PRIVATE");
ok(CsHub.parseVisibility({ code: 0, out: '{"visibility":"PUBLIC"}', err: "" }) ===
    "PUBLIC", "parseVisibility reads PUBLIC");
ok(CsHub.parseVisibility({ code: 1, out: "", err: "not found" }) === null,
    "parseVisibility returns null on failure");

ok(CsHub.isPrivate({ code: 0, out: '{"visibility":"PRIVATE"}', err: "" }) === true,
    "isPrivate accepts PRIVATE");
ok(CsHub.isPrivate({ code: 0, out: '{"visibility":"PUBLIC"}', err: "" }) === false,
    "isPrivate rejects PUBLIC");
ok(CsHub.isPrivate({ code: 0, out: '{"visibility":"INTERNAL"}', err: "" }) === false,
    "isPrivate rejects INTERNAL -- org-visible is not private");
ok(CsHub.isPrivate({ code: 1, out: "", err: "gh: command not found" }) === false,
    "isPrivate FAILS CLOSED when it cannot verify");

// Scopes. A token without repo makes a private repo 404, which reads as
// "no such repo" -- so this is checked explicitly rather than discovered.
var AUTH_OK = "github.com\n" +
    "  \u2713 Logged in to github.com account ndschonegg (keyring)\n" +
    "  - Active account: true\n" +
    "  - Git operations protocol: https\n" +
    "  - Token: gho_************************************\n" +
    "  - Token scopes: 'gist', 'read:org', 'repo'\n";
var AUTH_THIN = AUTH_OK.replace("'gist', 'read:org', 'repo'", "'gist', 'read:user'");

var scopes = CsHub.parseScopes({ code: 0, out: AUTH_OK, err: "" });
ok(scopes.indexOf("repo") !== -1, "parseScopes finds repo");
ok(scopes.indexOf("read:org") !== -1, "parseScopes finds read:org");
ok(CsHub.hasRepoScope({ code: 0, out: AUTH_OK, err: "" }) === true,
    "hasRepoScope true when repo present");
ok(CsHub.hasRepoScope({ code: 0, out: AUTH_THIN, err: "" }) === false,
    "hasRepoScope false when repo absent");
ok(CsHub.hasRepoScope({ code: 1, out: "", err: "not logged in" }) === false,
    "hasRepoScope false when not logged in");

ok(CsHub.parseLogin({ code: 0, out: AUTH_OK, err: "" }) === "ndschonegg",
    "parseLogin reads the account login");
ok(CsHub.parseLogin({ code: 1, out: "", err: "" }) === null,
    "parseLogin null when not logged in");
ok(CsHub.isAuthenticated({ code: 0, out: AUTH_OK, err: "" }) === true,
    "isAuthenticated true on a good status");
ok(CsHub.isAuthenticated({ code: 1, out: "",
        err: "You are not logged into any GitHub hosts." }) === false,
    "isAuthenticated false when logged out");

// gh writes auth status to stderr on some versions; both are accepted.
ok(CsHub.parseLogin({ code: 0, out: "", err: AUTH_OK }) === "ndschonegg",
    "parseLogin reads stderr too -- the stream is a gh implementation detail");

// noreply email, so a real address never lands in permanent history.
ok(CsHub.noreplyEmail({ id: 12345, login: "ndschonegg" }) ===
    "12345+ndschonegg@users.noreply.github.com", "noreplyEmail shape");
ok(CsHub.noreplyEmail(null) === null, "noreplyEmail null on no user");

var u = CsHub.parseApiUser({ code: 0,
    out: '{"login":"ndschonegg","id":12345,"name":"Nathan Schonegg"}', err: "" });
ok(u.login === "ndschonegg" && u.id === 12345 && u.name === "Nathan Schonegg",
    "parseApiUser reads login, id and name");
var u2 = CsHub.parseApiUser({ code: 0, out: '{"login":"solo","id":7,"name":null}',
    err: "" });
ok(u2.name === "solo", "parseApiUser falls back to login when name is null");
```

- [ ] **Step 2: Add to `CORE_FILES`** — after `CsGit.js`

```js
    "scripts/CaveSurvey/Core/CsHub.js",
```

- [ ] **Step 3: Run to verify failure**

Run: `./tests/run_all.sh 2>&1 | tail -20`
Expected: FAIL — `cannot open .../Core/CsHub.js`.

- [ ] **Step 4: Write CsHub.js**

```js
// CsHub.js -- the GitHub API, which for this add-on means the gh CLI.
//
// CaveCAD's script bridge has NO QNetworkAccessManager (probed
// 2026-08-20), so gh is not a convenience here, it is the only route
// to GitHub. That is why "gh is missing" and "gh is not authenticated"
// are first-class states rather than edge cases.
//
// Two checks carry the project's first rule:
//   isPrivate      -- decision 1, and it FAILS CLOSED. "Could not
//                     verify" is not "it is fine".
//   hasRepoScope   -- a token without `repo` makes a private repo
//                     return 404, not 403, which reads as "that repo
//                     does not exist" and sends the surveyor hunting
//                     the wrong problem.

function CsHub() {
}

CsHub.HOST = "github.com";
CsHub.SCOPES = "repo,read:org";

CsHub.argvAuthStatus = function() {
    return ["auth", "status"];
};

CsHub.argvDeviceLogin = function() {
    return ["auth", "login", "--web", "--git-protocol", "https",
            "--hostname", CsHub.HOST, "--scopes", CsHub.SCOPES,
            "--clipboard", "--skip-ssh-key"];
};

CsHub.argvTokenLogin = function() {
    return ["auth", "login", "--with-token", "--git-protocol", "https",
            "--hostname", CsHub.HOST];
};

CsHub.argvSetupGit = function() {
    return ["auth", "setup-git"];
};

CsHub.argvRefreshScope = function(scope) {
    return ["auth", "refresh", "-s", scope];
};

CsHub.argvRepoView = function(nameWithOwner) {
    return ["repo", "view", nameWithOwner, "--json",
            "visibility,nameWithOwner,defaultBranchRef"];
};

CsHub.argvRepoCreate = function(name) {
    return ["repo", "create", name, "--private"];
};

CsHub.argvApiUser = function() {
    return ["api", "user"];
};

CsHub.argvVersion = function() {
    return ["--version"];
};

// gh writes human-readable status to stderr on some versions and
// stdout on others. Which one is not a contract, so read both.
CsHub.textOf = function(r) {
    if (!r) {
        return "";
    }
    return String(r.out === undefined || r.out === null ? "" : r.out) + "\n" +
           String(r.err === undefined || r.err === null ? "" : r.err);
};

CsHub.parseJson = function(r) {
    if (!r || r.code !== 0) {
        return null;
    }
    try {
        return JSON.parse(String(r.out));
    } catch (e) {
        return null;
    }
};

CsHub.parseVisibility = function(r) {
    var j = CsHub.parseJson(r);
    if (j === null || !j.visibility) {
        return null;
    }
    return String(j.visibility).toUpperCase();
};

/**
 * True ONLY for a repo gh positively reports as PRIVATE.
 *
 * INTERNAL is rejected: org-wide visibility is not private, and an
 * entrance coordinate does not care about the distinction. A failed
 * call is rejected too -- see the fail-closed note at the top.
 */
CsHub.isPrivate = function(r) {
    return CsHub.parseVisibility(r) === "PRIVATE";
};

CsHub.isAuthenticated = function(r) {
    if (!r || r.code !== 0) {
        return false;
    }
    return /Logged in to /i.test(CsHub.textOf(r));
};

CsHub.parseLogin = function(r) {
    if (!r || r.code !== 0) {
        return null;
    }
    var m = CsHub.textOf(r).match(/Logged in to \S+ account (\S+)/i);
    return m === null ? null : m[1];
};

CsHub.parseScopes = function(r) {
    if (!r || r.code !== 0) {
        return [];
    }
    var m = CsHub.textOf(r).match(/Token scopes:([^\n]*)/i);
    if (m === null) {
        return [];
    }
    var scopes = [];
    var parts = m[1].split(",");
    for (var i = 0; i < parts.length; i++) {
        var s = parts[i].replace(/['"\s]/g, "");
        if (s.length > 0) {
            scopes.push(s);
        }
    }
    return scopes;
};

CsHub.hasRepoScope = function(r) {
    return CsHub.parseScopes(r).indexOf("repo") !== -1;
};

CsHub.parseApiUser = function(r) {
    var j = CsHub.parseJson(r);
    if (j === null || !j.login) {
        return null;
    }
    return {
        login: String(j.login),
        id: j.id,
        // GitHub's name field is null for accounts that never set one.
        name: (j.name === null || j.name === undefined || String(j.name).length === 0)
              ? String(j.login) : String(j.name)
    };
};

/**
 * The noreply address, so a surveyor's real email never lands in a
 * commit -- which is permanent in history and readable by every
 * collaborator added later.
 */
CsHub.noreplyEmail = function(user) {
    if (!user || !user.login) {
        return null;
    }
    return String(user.id) + "+" + String(user.login) +
           "@users.noreply." + CsHub.HOST;
};
```

- [ ] **Step 5: Run to verify pass**

Run: `./tests/run_all.sh 2>&1 | tail -6`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 6: Add to CsAll.js** — after the `CsGit.js` include

```js
include(includeBasePath + "/CsHub.js");
```

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsHub.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: CsHub -- gh argv, JSON parsing, and a fail-closed privacy gate"
```

---

### Task 4: CsSetup — executable discovery and install help

**Goal:** Find `git` and `gh` without trusting `PATH`, and produce the right install instructions for each platform when they are missing.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsSetup.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsSetup.candidates("osx", "gh")` puts `/opt/homebrew/bin/gh` before `/usr/local/bin/gh`, and the bare name `gh` last.
- [ ] `CsSetup.resolve` returns the first candidate an injected `exists` predicate accepts.
- [ ] A cached path that no longer exists is discarded and discovery re-runs.
- [ ] `CsSetup.installHelp` returns a command and at least one link for each of `osx`, `win`, `linux`, for both `git` and `gh`.
- [ ] The `gh` help always includes `https://cli.github.com/`.

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing tests** — append to `tests/js_unit.js`

```js
// ---------------------------------------------------------------------
// CsSetup -- discovery and install help.
//
// PATH is checked LAST, deliberately. The probe that found gh working
// inside CaveCAD ran the app FROM A TERMINAL, so it inherited a login
// shell PATH. Launched from Finder, a macOS GUI app has no
// /opt/homebrew/bin -- gh would read as "not installed" on a machine
// that has it.
// ---------------------------------------------------------------------

var ghMac = CsSetup.candidates("osx", "gh");
ok(ghMac[0] === "/opt/homebrew/bin/gh", "osx tries Homebrew arm64 first");
ok(ghMac.indexOf("/usr/local/bin/gh") > 0, "osx includes Homebrew intel prefix");
ok(ghMac[ghMac.length - 1] === "gh", "bare name (PATH) is LAST, not first");

var gitLinux = CsSetup.candidates("linux", "git");
ok(gitLinux[0] === "/usr/bin/git", "linux tries /usr/bin first");
ok(gitLinux[gitLinux.length - 1] === "git", "linux falls back to PATH last");

var ghWin = CsSetup.candidates("win", "gh");
ok(ghWin[ghWin.length - 1] === "gh.exe", "win falls back to gh.exe on PATH");
ok(ghWin.length > 1, "win has at least one absolute candidate");

// resolve() takes an injected existence predicate so this is testable
// with no filesystem.
var present = { "/usr/local/bin/gh": true };
ok(CsSetup.resolve("gh", "osx", function(p) { return present[p] === true; }) ===
    "/usr/local/bin/gh", "resolve picks the first existing candidate");
ok(CsSetup.resolve("gh", "osx", function() { return false; }) === null,
    "resolve returns null when nothing exists");

// A stale cache must not survive.
ok(CsSetup.validateCached("/opt/homebrew/bin/gh",
        function() { return false; }) === null,
    "validateCached discards a path that no longer resolves");
ok(CsSetup.validateCached("/usr/local/bin/gh",
        function(p) { return present[p] === true; }) === "/usr/local/bin/gh",
    "validateCached keeps a path that still resolves");
ok(CsSetup.validateCached("", function() { return true; }) === null,
    "validateCached rejects an empty cached value");

// Install help, per platform. Every rung's dialog is a remedy, so the
// text is asserted rather than left to whoever writes the dialog.
var hMac = CsSetup.installHelp("osx", "gh");
ok(hMac.command === "brew install gh", "osx gh command is brew install gh");
ok(hMac.links.join(" ").indexOf("https://cli.github.com/") !== -1,
    "osx gh help links cli.github.com");
var hWin = CsSetup.installHelp("win", "gh");
ok(hWin.command === "winget install -e --id GitHub.cli", "win gh command is winget");
var hLin = CsSetup.installHelp("linux", "gh");
ok(hLin.links.join(" ").indexOf("install_linux.md") !== -1,
    "linux gh help links the distro instructions");
var gMac = CsSetup.installHelp("osx", "git");
ok(gMac.command === "xcode-select --install", "osx git command is xcode-select");
var gWin = CsSetup.installHelp("win", "git");
ok(gWin.links.join(" ").indexOf("git-scm.com/download/win") !== -1,
    "win git help links git-scm");
var gLin = CsSetup.installHelp("linux", "git");
ok(gLin.links.length > 0, "linux git help has a link");
ok(CsSetup.installHelp("osx", "nonsense") === null,
    "installHelp returns null for an unknown program");
```

- [ ] **Step 2: Add to `CORE_FILES`** — after `CsHub.js`

```js
    "scripts/CaveSurvey/Core/CsSetup.js",
```

- [ ] **Step 3: Run to verify failure**

Run: `./tests/run_all.sh 2>&1 | tail -20`
Expected: FAIL — `cannot open .../Core/CsSetup.js`.

- [ ] **Step 4: Write CsSetup.js — discovery half**

```js
// CsSetup.js -- getting a machine ready to use GitHub from CaveCAD.
//
// Six rungs, each with its own remedy, because these fail in ways that
// look like something else:
//
//   no credential helper -> an HTTPS push waits for a password on a
//                           terminal that does not exist, so it hangs
//   no user.email        -> commit refuses to run
//   token without repo   -> a private repo returns 404, reading as
//                           "no such repository"
//
// Discovery does NOT trust PATH. See the note in the tests.

function CsSetup() {
}

CsSetup.SETTING_GIT = "CaveSurvey/GitPath";
CsSetup.SETTING_GH = "CaveSurvey/GhPath";

CsSetup.systemId = function() {
    if (typeof RS !== "undefined" && RS.getSystemId) {
        try {
            return RS.getSystemId();
        } catch (e) {
        }
    }
    return "osx";
};

/**
 * Absolute candidates first, the bare name (i.e. PATH) LAST.
 *
 * A macOS GUI app launched from Finder has a minimal PATH with no
 * /opt/homebrew/bin, so PATH-first discovery reports gh as missing on
 * machines that have it.
 */
CsSetup.candidates = function(system, name) {
    var exe = (system === "win") ? name + ".exe" : name;
    var dirs;
    if (system === "win") {
        dirs = [
            "C:/Program Files/GitHub CLI",
            "C:/Program Files/Git/cmd",
            "C:/Program Files (x86)/GitHub CLI"
        ];
    } else if (system === "linux") {
        dirs = ["/usr/bin", "/usr/local/bin", "/snap/bin"];
    } else {
        dirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"];
    }
    var out = [];
    for (var i = 0; i < dirs.length; i++) {
        out.push(dirs[i] + "/" + exe);
    }
    out.push(exe);
    return out;
};

// Injectable so the tests need no filesystem.
CsSetup.fileExists = function(path) {
    if (typeof QFileInfo === "undefined") {
        return false;
    }
    try {
        var fi = new QFileInfo(path);
        return fi.exists() && fi.isFile();
    } catch (e) {
        return false;
    }
};

CsSetup.resolve = function(name, system, existsFn) {
    var exists = existsFn ? existsFn : CsSetup.fileExists;
    var sys = system ? system : CsSetup.systemId();
    var cands = CsSetup.candidates(sys, name);
    for (var i = 0; i < cands.length; i++) {
        // The bare name is last and cannot be stat'ed usefully; treat
        // it as the always-available fallback.
        if (i === cands.length - 1) {
            return cands[i];
        }
        if (exists(cands[i])) {
            return cands[i];
        }
    }
    return null;
};

CsSetup.validateCached = function(cached, existsFn) {
    if (!cached || String(cached).length === 0) {
        return null;
    }
    var exists = existsFn ? existsFn : CsSetup.fileExists;
    return exists(cached) ? cached : null;
};

CsSetup.INSTALL_HELP = {
    osx: {
        git: { command: "xcode-select --install",
               links: ["https://git-scm.com/download/mac"] },
        gh: { command: "brew install gh",
              links: ["https://cli.github.com/",
                      "https://github.com/cli/cli/releases/latest"] }
    },
    win: {
        git: { command: "winget install -e --id Git.Git",
               links: ["https://git-scm.com/download/win"] },
        gh: { command: "winget install -e --id GitHub.cli",
              links: ["https://cli.github.com/"] }
    },
    linux: {
        git: { command: "sudo apt install git",
               links: ["https://git-scm.com/download/linux"] },
        gh: { command: "",
              links: ["https://cli.github.com/",
                      "https://github.com/cli/cli/blob/trunk/docs/install_linux.md"] }
    }
};

CsSetup.installHelp = function(system, name) {
    var sys = CsSetup.INSTALL_HELP[system] ? system : "osx";
    var entry = CsSetup.INSTALL_HELP[sys][name];
    return entry ? entry : null;
};
```

- [ ] **Step 5: Run to verify pass**

Run: `./tests/run_all.sh 2>&1 | tail -6`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 6: Add to CsAll.js** — after the `CsHub.js` include

```js
include(includeBasePath + "/CsSetup.js");
```

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/Core/CsSetup.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js
git commit -m "feat: CsSetup discovery -- candidate paths first, PATH last"
```

---

### Task 5: The preflight ladder and the device-code parser

**Goal:** The six rungs as pure functions over injected command results, plus the parser that pulls the one-time code out of gh's device-flow output.

**Files:**
- Modify: `scripts/CaveSurvey/Core/CsSetup.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsSetup.parseDeviceCode` finds `XXXX-XXXX` in gh's real output shape, from stdout or stderr, with or without the `!` prefix, and returns null when absent.
- [ ] `CsSetup.parseDeviceUrl` returns `https://github.com/login/device`.
- [ ] `CsSetup.ladder` returns one entry per rung, in order, each with `id`, `ok`, and `remedy`.
- [ ] The ladder stops at the first failing rung rather than reporting cascading failures — a missing `gh` must not also report "not authenticated" and "no credential helper".
- [ ] `CsSetup.identityPlan` produces per-repo config by default and global only when asked.

**Verify:** `./tests/run_all.sh` → `ALL TESTS PASSED`

**Steps:**

- [ ] **Step 1: Write the failing tests** — append to `tests/js_unit.js`

```js
// ---------------------------------------------------------------------
// CsSetup -- device-flow parsing and the preflight ladder.
//
// The device output below is VERBATIM from a probe of gh 2.97.0 run
// with no TTY inside CaveCAD 3.33.0 on 2026-08-20. gh printed the code
// and the URL and then blocked polling: it did not demand a terminal
// and did not wait for Enter. That is what makes in-app login possible.
// ---------------------------------------------------------------------

var GH_DEVICE_OUT = "\n! First copy your one-time code: D68F-995C\n" +
    "Open this URL to continue in your web browser: " +
    "https://github.com/login/device\n";

ok(CsSetup.parseDeviceCode(GH_DEVICE_OUT) === "D68F-995C",
    "parseDeviceCode reads the real gh output");
ok(CsSetup.parseDeviceCode("First copy your one-time code: ABCD-1234") === "ABCD-1234",
    "parseDeviceCode works without the ! prefix");
ok(CsSetup.parseDeviceCode("one-time code: 12AB-CD34") === "12AB-CD34",
    "parseDeviceCode accepts digits in either half");
ok(CsSetup.parseDeviceCode("nothing here") === null,
    "parseDeviceCode returns null when absent");
ok(CsSetup.parseDeviceCode("") === null, "parseDeviceCode tolerates empty input");
ok(CsSetup.parseDeviceCode(null) === null, "parseDeviceCode tolerates null");
ok(CsSetup.parseDeviceUrl(GH_DEVICE_OUT) === "https://github.com/login/device",
    "parseDeviceUrl reads the device URL");
ok(CsSetup.parseDeviceUrl("no url") === "https://github.com/login/device",
    "parseDeviceUrl falls back to the canonical URL");

// The ladder. Each rung is fed a canned command result, so no process
// runs and no network is touched.
function ladderWith(over) {
    var base = {
        gitPath: "/usr/bin/git",
        ghPath: "/opt/homebrew/bin/gh",
        authStatus: { code: 0, out: AUTH_OK, err: "" },
        credentialHelper: { code: 0, out: "credential.helper osxkeychain\n", err: "" },
        userName: { code: 0, out: "Nathan Schonegg\n", err: "" },
        userEmail: { code: 0, out: "1+n@users.noreply.github.com\n", err: "" }
    };
    for (var k in over) {
        if (over.hasOwnProperty(k)) {
            base[k] = over[k];
        }
    }
    return CsSetup.ladder(base, "osx");
}

var allGood = ladderWith({});
ok(allGood.length === 6, "the ladder has six rungs");
ok(allGood[0].id === "git" && allGood[1].id === "gh" &&
   allGood[2].id === "auth" && allGood[3].id === "scope" &&
   allGood[4].id === "helper" && allGood[5].id === "identity",
    "rungs are in order: git, gh, auth, scope, helper, identity");
var allOk = true;
for (var li = 0; li < allGood.length; li++) {
    if (!allGood[li].ok) {
        allOk = false;
    }
}
ok(allOk, "a fully configured machine passes every rung");
ok(CsSetup.firstFailure(allGood) === null,
    "firstFailure is null when everything passes");

// Missing gh must not cascade into three more failures.
var noGh = ladderWith({ ghPath: null });
ok(noGh[1].ok === false, "missing gh fails its own rung");
ok(noGh[1].remedy.indexOf("cli.github.com") !== -1,
    "the gh rung's remedy carries the install link");
ok(noGh[2].ok === null, "auth rung is NOT EVALUATED when gh is missing");
ok(noGh[3].ok === null, "scope rung is not evaluated either");
ok(CsSetup.firstFailure(noGh).id === "gh", "firstFailure names the gh rung");

var noGit = ladderWith({ gitPath: null });
ok(noGit[0].ok === false, "missing git fails rung 1");
ok(noGit[1].ok === null, "nothing after a missing git is evaluated");

var loggedOut = ladderWith({
    authStatus: { code: 1, out: "",
                  err: "You are not logged into any GitHub hosts." } });
ok(loggedOut[2].ok === false, "logged out fails the auth rung");
ok(loggedOut[3].ok === null, "scope is not evaluated when logged out");

var thinScope = ladderWith({ authStatus: { code: 0, out: AUTH_THIN, err: "" } });
ok(thinScope[2].ok === true, "a thin token is still authenticated");
ok(thinScope[3].ok === false, "the scope rung catches a token without repo");
ok(thinScope[3].remedy.indexOf("auth refresh") !== -1,
    "the scope remedy is gh auth refresh");
ok(thinScope[3].remedy.indexOf("404") !== -1,
    "the scope remedy explains the 404 symptom");

var noHelper = ladderWith({ credentialHelper: { code: 1, out: "", err: "" } });
ok(noHelper[4].ok === false, "a failed setup-git fails the helper rung");

var noIdentity = ladderWith({ userEmail: { code: 1, out: "", err: "" } });
ok(noIdentity[5].ok === false, "a missing user.email fails the identity rung");

// Identity plan: per-repo unless asked, so a developer's global git
// config is never silently rewritten.
var idLocal = CsSetup.identityPlan({ login: "ndschonegg", id: 12345,
    name: "Nathan Schonegg" }, false);
ok(idLocal.length === 2, "identityPlan sets name and email");
ok(idLocal[0].join(" ").indexOf("--global") === -1,
    "identityPlan is LOCAL by default");
ok(idLocal[1][idLocal[1].length - 1] ===
    "12345+ndschonegg@users.noreply.github.com",
    "identityPlan uses the noreply address");
var idGlobal = CsSetup.identityPlan({ login: "ndschonegg", id: 12345,
    name: "Nathan Schonegg" }, true);
ok(idGlobal[0].indexOf("--global") !== -1,
    "identityPlan honours the global flag when asked");
ok(CsSetup.identityPlan(null, false).length === 0,
    "identityPlan is empty without a user");
```

- [ ] **Step 2: Run to verify failure**

Run: `./tests/run_all.sh 2>&1 | tail -20`
Expected: FAIL — several `FAIL:` lines naming `parseDeviceCode` and `the ladder has six rungs`, because those functions do not exist.

- [ ] **Step 3: Append the ladder to CsSetup.js**

```js
// ---------------------------------------------------------------------
// Device flow
// ---------------------------------------------------------------------

CsSetup.DEVICE_URL = "https://github.com/login/device";

// gh prints "! First copy your one-time code: XXXX-XXXX". Which stream
// it lands on is an implementation detail, so callers pass both
// concatenated and this only cares about the shape.
CsSetup.parseDeviceCode = function(text) {
    if (text === null || text === undefined) {
        return null;
    }
    var m = String(text).match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i);
    return m === null ? null : m[1].toUpperCase();
};

CsSetup.parseDeviceUrl = function(text) {
    var s = String(text === null || text === undefined ? "" : text);
    var m = s.match(/https:\/\/\S*github\.com\/login\/device\S*/i);
    return m === null ? CsSetup.DEVICE_URL : m[0];
};

// ---------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------

// ok === true  passed
// ok === false failed, remedy applies
// ok === null  NOT EVALUATED, because an earlier rung failed. Reporting
//              "not authenticated" under "gh is not installed" sends
//              the surveyor after three problems that are one problem.
CsSetup.rung = function(id, label, ok, remedy) {
    return { id: id, label: label, ok: ok, remedy: remedy === undefined ? "" : remedy };
};

CsSetup.ladder = function(probe, system) {
    var sys = system ? system : CsSetup.systemId();
    var rungs = [];
    var blocked = false;

    function skip(id, label) {
        rungs.push(CsSetup.rung(id, label, null, ""));
    }

    // 1. git
    var gitHelp = CsSetup.installHelp(sys, "git");
    if (probe.gitPath) {
        rungs.push(CsSetup.rung("git", "git installed", true));
    } else {
        rungs.push(CsSetup.rung("git", "git installed", false,
            "git was not found. Install it with: " + gitHelp.command +
            "  --  " + gitHelp.links.join(" ")));
        blocked = true;
    }

    // 2. gh
    var ghHelp = CsSetup.installHelp(sys, "gh");
    if (blocked) {
        skip("gh", "GitHub CLI installed");
    } else if (probe.ghPath) {
        rungs.push(CsSetup.rung("gh", "GitHub CLI installed", true));
    } else {
        rungs.push(CsSetup.rung("gh", "GitHub CLI installed", false,
            "The GitHub CLI was not found. Install it with: " +
            (ghHelp.command.length > 0 ? ghHelp.command + "  --  " : "") +
            ghHelp.links.join(" ")));
        blocked = true;
    }

    // 3. authenticated
    if (blocked) {
        skip("auth", "Signed in to GitHub");
    } else if (CsHub.isAuthenticated(probe.authStatus)) {
        rungs.push(CsSetup.rung("auth", "Signed in to GitHub", true));
    } else {
        rungs.push(CsSetup.rung("auth", "Signed in to GitHub", false,
            "Not signed in. Use Sign in to GitHub below -- it opens your " +
            "browser and no password passes through CaveCAD."));
        blocked = true;
    }

    // 4. repo scope
    if (blocked) {
        skip("scope", "Token can see private repositories");
    } else if (CsHub.hasRepoScope(probe.authStatus)) {
        rungs.push(CsSetup.rung("scope", "Token can see private repositories", true));
    } else {
        rungs.push(CsSetup.rung("scope", "Token can see private repositories", false,
            "This token lacks the 'repo' scope, so a private cave repository " +
            "returns 404 -- it looks as though it does not exist. Fix with: " +
            "gh auth refresh -s repo"));
        blocked = true;
    }

    // 5. credential helper -- READ-ONLY, and ANY helper passes.
    //
    // The earlier draft read probe.setupGit, populated by RUNNING
    // `gh auth setup-git` -- but that command CONFIGURES the helper, so the
    // check was the mutation and opening the dialog would rewrite the user's
    // git config. It also demanded gh's own helper; on the development
    // machine credential.helper is `osxkeychain` with no gh helper at all,
    // and gh plus push work fine. Requiring gh's would tell someone to fix
    // what is not broken.
    if (blocked) {
        skip("helper", "git can authenticate to GitHub");
    } else if (probe.credentialHelper && probe.credentialHelper.code === 0 &&
               String(probe.credentialHelper.out).replace(/\s/g, "").length > 0) {
        rungs.push(CsSetup.rung("helper", "git can authenticate to GitHub", true));
    } else {
        rungs.push(CsSetup.rung("helper", "git can authenticate to GitHub", false,
            "git has no credential helper, so an HTTPS push waits for a " +
            "password prompt on a terminal that does not exist -- it hangs " +
            "rather than failing. Offer to run: gh auth setup-git"));
        blocked = true;
    }

    // 6. identity
    if (blocked) {
        skip("identity", "Commit name and email set");
    } else {
        var haveName = probe.userName && probe.userName.code === 0 &&
            String(probe.userName.out).replace(/\s/g, "").length > 0;
        var haveEmail = probe.userEmail && probe.userEmail.code === 0 &&
            String(probe.userEmail.out).replace(/\s/g, "").length > 0;
        if (haveName && haveEmail) {
            rungs.push(CsSetup.rung("identity", "Commit name and email set", true));
        } else {
            rungs.push(CsSetup.rung("identity", "Commit name and email set", false,
                "git has no commit identity, so a commit refuses to run. " +
                "Set it from your GitHub account below."));
        }
    }

    return rungs;
};

CsSetup.firstFailure = function(rungs) {
    for (var i = 0; i < rungs.length; i++) {
        if (rungs[i].ok === false) {
            return rungs[i];
        }
    }
    return null;
};

/**
 * Returns argv arrays for setting the commit identity.
 *
 * LOCAL by default: silently rewriting a developer's global git
 * identity is an overreach, and this add-on runs on machines that do
 * other work.
 */
CsSetup.identityPlan = function(user, global) {
    if (!user || !user.login) {
        return [];
    }
    var email = CsHub.noreplyEmail(user);
    return [
        CsGit.argvConfigSet("user.name", user.name, global === true),
        CsGit.argvConfigSet("user.email", email, global === true)
    ];
};
```

- [ ] **Step 4: Run to verify pass**

Run: `./tests/run_all.sh 2>&1 | tail -6`
Expected: `ALL TESTS PASSED`.

- [ ] **Step 5: Commit**

```bash
git add scripts/CaveSurvey/Core/CsSetup.js tests/js_unit.js
git commit -m "feat: the preflight ladder, and a device-code parser built from a real probe"
```

---

### Qt surface for Tasks 6 and 7 — VERIFIED, do not re-derive

Probed live in CaveCAD 3.33.0's engine on 2026-08-21. Every class these two tasks
need is present, and widgets construct even under `-no-gui`:

`QDialog`, `QVBoxLayout`, `QHBoxLayout`, `QGridLayout`, `QLabel`, `QPushButton`,
`QLineEdit`, `QDesktopServices`, `QUrl`, `QCoreApplication`, `QFont`, `QTimer`,
`QProgressDialog`, `QMessageBox`, `QClipboard`, `QTreeWidget`, `QTreeWidgetItem`,
`QTextEdit`, `QPlainTextEdit`, `QWidget`.

Confirmed working: `new QUrl(...)` round-trips; `QLabel.text` readable;
`QDialog.windowTitle` assignable; `QPushButton.clicked` is a function and
`.clicked.connect(fn)` succeeds; `QVBoxLayout.addWidget` is a function;
`label.font` is readable and reports `pointSize() === 13`.

**One trap, and it is the shape of every defect in this slice:**

```
QDesktopServices.openUrl        -> function     OK
QCoreApplication.processEvents  -> function     OK -- USE THIS ONE
QApplication.processEvents      -> undefined    DOES NOT EXIST
```

Task 7's dialog uses `QCoreApplication.processEvents()`, which is correct. Do NOT
"fix" it to `QApplication.processEvents()`: that is undefined, and called inside the
dialog's `try/catch` it would fail silently, leaving the poll loop never pumping
events so the one-time code never appears on screen.

**What the probe does NOT establish:** headless construction is not proof of
rendering. That the dialog appears, that the code is legible at the enlarged font,
that buttons respond to clicks, and that `show()` plus the poll loop does not freeze
the main window are all Task 8 items and cannot be closed from a script.

### Task 6: GitHubSetup tool — menu wiring and the ladder display

**Goal:** The tool appears on the Cave Survey menu, runs the ladder against the real machine, and shows each rung with its remedy.

**Files:**
- Create: `scripts/CaveSurvey/GitHubSetup/GitHubSetup.js`
- Create: `scripts/CaveSurvey/GitHubSetup/GitHubSetup.svg`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `./tests/run_all.sh --publish` passes, which requires the icon to exist, be parseable SVG, and the action to have a status tip.
- [ ] Sort order is 22 and `test_sort_orders_are_unique` still passes.
- [ ] `CsSetup.probe` collects the six inputs by running real commands through `CsProc`, and is exercised in the unit tests with an injected backend.
- [ ] The tool's action does not require a document (`setRequiresDocument(false)`) — setup must work with no drawing open.

**Verify:** `./tests/run_all.sh --publish` → `ALL TESTS PASSED -- including publish checks`

**Steps:**

- [ ] **Step 1: Write the failing test for probe** — append to `tests/js_unit.js`

```js
// ---------------------------------------------------------------------
// CsSetup.probe -- collects the ladder's inputs through CsProc.
// ---------------------------------------------------------------------

var probeCalls = [];
CsProc.setBackend(function(prog, argv) {
    probeCalls.push(prog + " " + argv.join(" "));
    if (argv[0] === "auth" && argv[1] === "status") {
        return { code: 0, out: AUTH_OK, err: "", timedOut: false };
    }
    if (argv[0] === "config" && argv[1] === "--get" && argv[2] === "user.name") {
        return { code: 0, out: "Nathan Schonegg\n", err: "", timedOut: false };
    }
    if (argv[0] === "config" && argv[1] === "--get" && argv[2] === "user.email") {
        return { code: 0, out: "1+n@users.noreply.github.com\n", err: "",
                 timedOut: false };
    }
    return { code: 0, out: "", err: "", timedOut: false };
});

var probed = CsSetup.probe("/usr/bin/git", "/opt/homebrew/bin/gh");
ok(probed.gitPath === "/usr/bin/git", "probe carries the git path through");
ok(CsHub.isAuthenticated(probed.authStatus) === true,
    "probe collects auth status");
ok(probed.userName.out.indexOf("Nathan") !== -1, "probe collects user.name");
var probeLadder = CsSetup.ladder(probed, "osx");
ok(CsSetup.firstFailure(probeLadder) === null,
    "a probe of a configured machine passes the ladder");

// A missing gh must short-circuit: no gh commands may be attempted.
probeCalls = [];
var probedNoGh = CsSetup.probe("/usr/bin/git", null);
var ghAttempts = 0;
for (var pci = 0; pci < probeCalls.length; pci++) {
    if (probeCalls[pci].indexOf("auth") !== -1) {
        ghAttempts++;
    }
}
ok(ghAttempts === 0, "probe does not run gh when gh is missing");
ok(CsSetup.firstFailure(CsSetup.ladder(probedNoGh, "osx")).id === "gh",
    "a probe without gh fails at the gh rung");

CsProc.setBackend(null);
```

- [ ] **Step 2: Run to verify failure**

Run: `./tests/run_all.sh 2>&1 | tail -20`
Expected: FAIL — `probe carries the git path through`, because `CsSetup.probe` does not exist.

- [ ] **Step 3: Append probe to CsSetup.js**

```js
/**
 * Runs the commands the ladder needs and returns its input record.
 *
 * Short-circuits: with no gh path, no gh command is attempted at all.
 * Running `gh auth status` against a nonexistent binary produces an
 * error that describes the wrong problem.
 */
CsSetup.probe = function(gitPath, ghPath) {
    var probe = {
        gitPath: gitPath,
        ghPath: ghPath,
        authStatus: null,
        credentialHelper: null,
        userName: null,
        userEmail: null
    };
    if (!gitPath) {
        return probe;
    }
    probe.userName = CsProc.run(gitPath, CsGit.argvConfigGet("user.name"));
    probe.userEmail = CsProc.run(gitPath, CsGit.argvConfigGet("user.email"));
    if (!ghPath) {
        return probe;
    }
    // READ-ONLY. Never run `gh auth setup-git` from a probe -- it
    // configures the helper, so the check would be the mutation.
    probe.credentialHelper = CsProc.run(gitPath,
        ["config", "--get-regexp", "^credential"]);
    probe.authStatus = CsProc.run(ghPath, CsHub.argvAuthStatus());
    return probe;
};
```

- [ ] **Step 4: Write the tool**

```js
// GitHubSetup.js
//
// QCAD add-on tool: gets this machine ready to use GitHub from inside
// CaveCAD, and says exactly what is missing when it is not.
//
// The ladder and every string it reports live in CsSetup, which is
// unit-tested; this file is the window onto it. Sign-in uses gh's
// DEVICE FLOW: gh prints a one-time code, the browser does the
// authenticating, and no password or token passes through CaveCAD.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

function GitHubSetup(guiAction) {
    EAction.call(this, guiAction);
}

GitHubSetup.prototype = new EAction();

GitHubSetup.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    GitHubSetup.showLadder();
    this.terminate();
};

// SUPERSEDED BY TASK 5 -- do not write this. It calls CsSetup.resolve(),
// which is stat-only and reports a gh that lives outside the candidate
// directories as MISSING even when it is on PATH and works (MacPorts,
// ~/.local/bin, Nix). That is the exact blind spot CsSetup.discover was
// added to close, and Task 5 packaged the correct form as
// CsSetup.discoverTools(). Call that instead:
//
//     var tools = CsSetup.discoverTools();   // {gitPath, ghPath}
//
// Caching caveat, proven live: discover() may answer with the BARE NAME
// for a PATH-only install, and validateCached() stats it -- a relative
// name stats against the process cwd, which inside CaveCAD is
// .../CaveCAD.app/Contents/Resources. So only an ABSOLUTE path is
// cacheable; see CsSetup.isCacheable.
GitHubSetup.resolveTools = function() {
    return CsSetup.discoverTools();
};

GitHubSetup.showLadder = function() {
    var tools = GitHubSetup.resolveTools();
    var probe = CsSetup.probe(tools.git, tools.gh);
    var rungs = CsSetup.ladder(probe);

    var lines = [];
    for (var i = 0; i < rungs.length; i++) {
        var r = rungs[i];
        var mark = (r.ok === true) ? "OK  " : (r.ok === false ? "X   " : "--  ");
        lines.push(mark + r.label);
        if (r.ok === false && r.remedy.length > 0) {
            lines.push("      " + r.remedy);
        }
    }

    var failure = CsSetup.firstFailure(rungs);
    if (failure === null) {
        EAction.handleUserMessage(qsTr("GitHub setup: ready.") + "\n" +
            lines.join("\n"));
        return;
    }

    EAction.handleUserWarning(qsTr("GitHub setup is incomplete:") + "\n" +
        lines.join("\n"));

    // Only the rungs this tool can act on get an offer; an install is
    // the user's to run, and the plugin never downloads an installer.
    if (failure.id === "auth") {
        GitHubSetup.offerSignIn(tools.gh);
    } else if (failure.id === "scope") {
        GitHubSetup.runAndReport(tools.gh, CsHub.argvRefreshScope("repo"),
            qsTr("Requesting the repo scope"));
    } else if (failure.id === "helper") {
        GitHubSetup.runAndReport(tools.gh, CsHub.argvSetupGit(),
            qsTr("Configuring git's credential helper"));
    } else if (failure.id === "identity") {
        GitHubSetup.setIdentity(tools.git, tools.gh);
    } else if (failure.remedy.length > 0) {
        // git or gh missing: hand over the link, do not act.
        var help = CsSetup.installHelp(CsSetup.systemId(), failure.id);
        if (help !== null && help.links.length > 0 &&
            typeof QDesktopServices !== "undefined") {
            try {
                QDesktopServices.openUrl(new QUrl(help.links[0]));
            } catch (e) {
            }
        }
    }
};

GitHubSetup.runAndReport = function(prog, argv, what) {
    if (!prog) {
        return false;
    }
    var r = CsProc.run(prog, argv, { timeoutMs: 60000 });
    if (r.code === 0) {
        EAction.handleUserMessage(what + ": " + qsTr("done."));
        return true;
    }
    // Shortest decisive line, with the whole output in cave-git.log.
    var line = String(r.err).split("\n")[0];
    EAction.handleUserWarning(what + ": " + line);
    return false;
};

GitHubSetup.setIdentity = function(gitPath, ghPath) {
    if (!gitPath || !ghPath) {
        return;
    }
    var user = CsHub.parseApiUser(CsProc.run(ghPath, CsHub.argvApiUser()));
    if (user === null) {
        EAction.handleUserWarning(qsTr("Could not read your GitHub account."));
        return;
    }
    // Local by default. The noreply address keeps a real email out of
    // history, which is permanent and readable by anyone added later.
    var plan = CsSetup.identityPlan(user, false);
    for (var i = 0; i < plan.length; i++) {
        CsProc.run(gitPath, plan[i]);
    }
    EAction.handleUserMessage(qsTr("Commit identity set to %1 <%2> for this repository.")
        .arg(user.name).arg(CsHub.noreplyEmail(user)));
};

GitHubSetup.init = function(basePath) {
    var action = new RGuiAction(qsTr("GitHub Setup"), RMainWindowQt.getMainWindow());
    // Setup must work with no drawing open -- a new user has none.
    action.setRequiresDocument(false);
    action.setScriptFile(basePath + "/GitHubSetup.js");
    action.setIcon(basePath + "/GitHubSetup.svg");
    action.setStatusTip(qsTr("Check and finish this computer's GitHub setup"));
    action.setDefaultCommands(["githubsetup", "ghsetup"]);
    action.setGroupSortOrder(450);
    action.setSortOrder(22);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
};
```

- [ ] **Step 5: Write the icon** — `scripts/CaveSurvey/GitHubSetup/GitHubSetup.svg`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <title>GitHub Setup</title>
  <circle cx="9" cy="8" r="5.2" fill="none" stroke="#000000" stroke-width="1.6"/>
  <path d="M9 4.4 v3.6 l2.4 1.6" fill="none" stroke="#000000" stroke-width="1.4"
        stroke-linecap="round"/>
  <path d="M14.6 15.4 h5.6 M17.4 12.6 v5.6" fill="none" stroke="#000000"
        stroke-width="1.6" stroke-linecap="round"/>
  <path d="M3.4 15.2 c0 3 2.4 5.4 5.4 5.4" fill="none" stroke="#000000"
        stroke-width="1.4" stroke-linecap="round"/>
</svg>
```

- [ ] **Step 6: Run the full suite including publish checks**

Run: `./tests/run_all.sh --publish 2>&1 | tail -8`
Expected: `ALL TESTS PASSED -- including publish checks`. If `test_sort_orders_are_unique` fails, another tool already claims 22 — pick the next free value and update both the tool and this plan.

- [ ] **Step 7: Commit**

```bash
git add scripts/CaveSurvey/GitHubSetup scripts/CaveSurvey/Core/CsSetup.js tests/js_unit.js
git commit -m "feat: GitHubSetup tool -- the ladder, with a remedy per rung"
```

---

### Task 7: The device-flow sign-in dialog

**Goal:** Signing in from inside CaveCAD: the one-time code on screen, the browser opened, the `gh` child process waited on and killable.

**Files:**
- Modify: `scripts/CaveSurvey/GitHubSetup/GitHubSetup.js`
- Modify: `tests/js_unit.js`

**Acceptance Criteria:**
- [ ] `CsSetup.deviceLoginArgv` returns gh's device-flow argv, asserted exactly.
- [ ] `CsSetup.readDeviceCode` extracts the code from a combined stdout+stderr string using the real probe output as the fixture.
- [ ] The dialog is non-modal with respect to the code display, shows the code, and opens `https://github.com/login/device`.
- [ ] Cancel kills the `gh` process rather than orphaning it.
- [ ] On success the tool re-runs `gh auth status` rather than trusting the exit code, then runs `gh auth setup-git`.

**Verify:** `./tests/run_all.sh --publish` → `ALL TESTS PASSED -- including publish checks`

**Steps:**

- [ ] **Step 1: Write the failing tests** — append to `tests/js_unit.js`

```js
// ---------------------------------------------------------------------
// Device login -- argv and code extraction from a combined stream.
// ---------------------------------------------------------------------

sameArgv(CsSetup.deviceLoginArgv(), CsHub.argvDeviceLogin(),
    "deviceLoginArgv delegates to CsHub");
ok(CsSetup.readDeviceCode({ out: "", err: GH_DEVICE_OUT }) === "D68F-995C",
    "readDeviceCode finds the code on stderr");
ok(CsSetup.readDeviceCode({ out: GH_DEVICE_OUT, err: "" }) === "D68F-995C",
    "readDeviceCode finds the code on stdout");
ok(CsSetup.readDeviceCode({ out: "", err: "" }) === null,
    "readDeviceCode returns null before gh has printed anything");
ok(CsSetup.loginSucceeded({ code: 0, out: "", err: "" },
        { code: 0, out: AUTH_OK, err: "" }) === true,
    "loginSucceeded requires a passing auth status, not just exit 0");
ok(CsSetup.loginSucceeded({ code: 0, out: "", err: "" },
        { code: 1, out: "", err: "not logged in" }) === false,
    "loginSucceeded rejects exit 0 with a failing auth status");
ok(CsSetup.loginSucceeded({ code: 1, out: "", err: "cancelled" },
        { code: 0, out: AUTH_OK, err: "" }) === false,
    "loginSucceeded rejects a non-zero login even if status looks fine");
```

- [ ] **Step 2: Run to verify failure**

Run: `./tests/run_all.sh 2>&1 | tail -14`
Expected: FAIL — `deviceLoginArgv delegates to CsHub` and the `readDeviceCode` assertions.

- [ ] **Step 3: Append to CsSetup.js**

```js
CsSetup.deviceLoginArgv = function() {
    return CsHub.argvDeviceLogin();
};

CsSetup.readDeviceCode = function(streams) {
    if (!streams) {
        return null;
    }
    return CsSetup.parseDeviceCode(String(streams.out === undefined ? "" : streams.out) +
        "\n" + String(streams.err === undefined ? "" : streams.err));
};

/**
 * A login counts only when gh's own status agrees.
 *
 * Exit 0 alone is not enough: a cancelled or expired device flow can
 * still unwind cleanly, and a login that "succeeded" without a usable
 * token would send the surveyor into a 404 later instead of a clear
 * failure now.
 */
CsSetup.loginSucceeded = function(loginResult, statusResult) {
    if (!loginResult || loginResult.code !== 0) {
        return false;
    }
    return CsHub.isAuthenticated(statusResult);
};
```

- [ ] **Step 4: Append the dialog to GitHubSetup.js**

```js
/**
 * gh's device flow, driven from inside CaveCAD.
 *
 * Probed on 2026-08-20: with no TTY, `gh auth login --web` prints the
 * one-time code and the device URL and then blocks polling GitHub. It
 * does not demand a terminal and does not wait for Enter. So the code
 * can be shown here while gh does the waiting.
 *
 * QProcess is driven directly rather than through CsProc.run because
 * this is the one call that must be read WHILE it runs -- run() waits
 * for the process to finish, and the code is needed before then.
 */
GitHubSetup.offerSignIn = function(ghPath) {
    if (!ghPath) {
        return;
    }
    var proc = new QProcess();
    var dialog = new QDialog(RMainWindowQt.getMainWindow());
    dialog.windowTitle = qsTr("Sign in to GitHub");
    var layout = new QVBoxLayout();

    var codeLabel = new QLabel(qsTr("Starting sign-in..."));
    var font = codeLabel.font;
    font.setPointSize(font.pointSize() + 10);
    font.setBold(true);
    codeLabel.font = font;
    layout.addWidget(codeLabel, 0, 0);

    var help = new QLabel(qsTr("Enter this code in your browser. " +
        "The code is already on your clipboard."));
    help.wordWrap = true;
    layout.addWidget(help, 0, 0);

    var openButton = new QPushButton(qsTr("Open github.com/login/device"));
    layout.addWidget(openButton, 0, 0);
    var cancelButton = new QPushButton(qsTr("Cancel"));
    layout.addWidget(cancelButton, 0, 0);
    dialog.setLayout(layout);

    openButton.clicked.connect(function() {
        try {
            QDesktopServices.openUrl(new QUrl(CsSetup.DEVICE_URL));
        } catch (e) {
        }
    });
    cancelButton.clicked.connect(function() {
        // Kill, not terminate: an orphaned gh keeps polling GitHub
        // after the window is gone.
        try { proc.kill(); } catch (e) {}
        dialog.reject();
    });

    proc.start(ghPath, CsSetup.deviceLoginArgv());
    dialog.show();

    // Poll for the code, then for completion. waitForFinished would
    // freeze the window before the code could be read.
    var collected = { out: "", err: "" };
    var shown = false;
    var waitedMs = 0;
    var EXPIRY_MS = 15 * 60 * 1000;   // gh's own device-code expiry
    while (waitedMs < EXPIRY_MS) {
        if (proc.waitForFinished(250)) {
            break;
        }
        waitedMs += 250;
        collected.out += new QTextStream(proc.readAllStandardOutput()).readAll();
        collected.err += new QTextStream(proc.readAllStandardError()).readAll();
        if (!shown) {
            var code = CsSetup.readDeviceCode(collected);
            if (code !== null) {
                codeLabel.text = code;
                shown = true;
            }
        }
        QCoreApplication.processEvents();
        if (!dialog.visible) {
            break;
        }
    }
    collected.out += new QTextStream(proc.readAllStandardOutput()).readAll();
    collected.err += new QTextStream(proc.readAllStandardError()).readAll();
    var loginResult = { code: proc.exitCode(), out: collected.out, err: collected.err };
    dialog.accept();

    var status = CsProc.run(ghPath, CsHub.argvAuthStatus());
    if (!CsSetup.loginSucceeded(loginResult, status)) {
        var line = String(collected.err).split("\n")[0];
        EAction.handleUserWarning(qsTr("Sign-in did not complete. %1").arg(line));
        return;
    }
    EAction.handleUserMessage(qsTr("Signed in to GitHub as %1.")
        .arg(CsHub.parseLogin(status)));
    // Re-run rather than skip: a fresh login needs the helper wired.
    GitHubSetup.runAndReport(ghPath, CsHub.argvSetupGit(),
        qsTr("Configuring git's credential helper"));
};
```

- [ ] **Step 5: Run to verify pass**

Run: `./tests/run_all.sh --publish 2>&1 | tail -8`
Expected: `ALL TESTS PASSED -- including publish checks`.

- [ ] **Step 6: Commit**

```bash
git add scripts/CaveSurvey/Core/CsSetup.js scripts/CaveSurvey/GitHubSetup/GitHubSetup.js tests/js_unit.js
git commit -m "feat: device-flow sign-in from inside CaveCAD, no secret through the plugin"
```

---

### Task 8: Verify the ladder in a real CaveCAD window

**Goal:** Confirm in a running CaveCAD, launched from Finder, that the tool appears, resolves `gh`, and reports every rung correctly.

> **USER-ORDERED GATE — NON-SKIPPABLE.** This task was requested by the user in the current conversation. It MUST NOT be closed by walking around it, by declaring it "verified inline", or by substituting a cheaper check. Close only after every item in `acceptanceCriteria` has been re-validated independently, with output captured.

**Files:**
- Modify: none expected. Any fix goes in the file that owns the failure.

**Acceptance Criteria:**
- [ ] `./tools/publish.sh` completes and reports the new version installed.
- [ ] CaveCAD is launched **from Finder** (`open -a CaveCAD`), not from a terminal, so it inherits the minimal GUI `PATH`.
- [ ] "GitHub Setup" appears in the Cave Survey menu.
- [ ] Running it on this already-authenticated machine reports all six rungs passing — specifically proving `gh` was found despite the Finder `PATH`.
- [ ] `~/Library/Application Support/QCAD/CaveCAD/cave-git.log` contains the probe's commands and contains no token.

**Verify:**
```bash
cd ~/Documents/github/cavecad-tools && ./tools/publish.sh && open -a CaveCAD
```
then run the tool and read the log:
```bash
grep -c "auth status" ~/Library/Application\ Support/QCAD/CaveCAD/cave-git.log
grep -cE "gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+" ~/Library/Application\ Support/QCAD/CaveCAD/cave-git.log
```
Expected: at least 1 for the first, exactly 0 for the second.

**Steps:**

- [ ] **Step 1: Publish the add-on**

```bash
cd ~/Documents/github/cavecad-tools && ./tools/publish.sh
```
Expected: the structural, syntax and unit gates pass, then the install and archive lines. A failure here is a test failure, not a GUI problem — fix it before launching.

- [ ] **Step 2: Launch from Finder, not the terminal**

```bash
open -a CaveCAD
```
This is the whole point of the step: `open` hands the app launchd's minimal environment, the same one a double-click gives. Launching with `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD` would inherit this shell's `PATH` and hide the exact bug Task 4 exists to prevent.

- [ ] **Step 3: Run the tool**

Cave Survey > GitHub Setup. Expected: a message listing six rungs, every one marked `OK`.

If the `gh` rung reports missing, discovery is broken under the Finder environment — check `CsSetup.candidates` order and that `CsSetup.fileExists` returns true for `/opt/homebrew/bin/gh`. Do not "fix" it by adding a shell invocation; that reintroduces the shell-string problem CsProc exists to avoid.

- [ ] **Step 4: Confirm the log is written and clean**

```bash
tail -20 ~/Library/Application\ Support/QCAD/CaveCAD/cave-git.log
grep -cE "gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+" ~/Library/Application\ Support/QCAD/CaveCAD/cave-git.log
```
Expected: command lines with exit codes; `0` matches for the token pattern.

- [ ] **Step 5: Record the result**

Append a dated "GUI verified" line to the spec's GUI-verification list for items 1 and 4, noting what was observed. Do not mark items 2, 3, 5–8 — they belong to later slices.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-20-github-versioning-design.md
git commit -m "docs: record the GUI verification of the setup ladder"
```

---

## Self-review notes

**Spec coverage.** Executable discovery → Task 4. Ladder rungs 1–6 → Task 5, with `probe` in Task 6. Install links → Task 4. Device flow → Tasks 5 and 7. Token fallback → **not implemented in this slice**; the primary device flow covers the machines in play, and the fallback needs a masked-input dialog whose behavior under the brew bridge is unverified. Tracked as the first item of slice 2 rather than left as a stub here. Redaction → Task 1. `assertPrivate` → Task 3 as `CsHub.isPrivate`; its call sites arrive with clone and push in slice 2. Sort-order uniqueness assertion → already exists as `test_sort_orders_are_unique`, verified in Task 6 rather than duplicated.

**Naming consistency.** `CsProc.run`, `CsProc.setBackend`, `CsProc.redact`; `CsGit.argv*`/`CsGit.parse*`; `CsHub.argv*`/`CsHub.parse*`/`CsHub.isPrivate`/`CsHub.hasRepoScope`/`CsHub.noreplyEmail`; `CsSetup.candidates`/`resolve`/`validateCached`/`installHelp`/`ladder`/`firstFailure`/`probe`/`identityPlan`/`parseDeviceCode`/`readDeviceCode`/`loginSucceeded`. Used identically in every task.

**Deferred from Task 1, deliberately.** The quality review of `CsProc` raised log rotation
— `cave-git.log` grows unbounded, and "auto-push after every save" makes it a hot path. Left
out: it is a behavior change that wants its own rotation policy, and nothing auto-pushes
until slice 2. It belongs with the save wrapper, where it starts to matter.

**Not in this slice:** `CsRepo`, `CsSidecar`, `CsCommitMsg`, `CsSync`, the save wrapper, `CloneProject`, `InitCaveRepo`, `SyncProject`, `ProjectStatus`, `OpenPullRequest`. Slice 2 also depends on a GUI pass of the revision framework, which is not this plan's work.
