# Send Feedback — design

Date: 2026-09-27
Status: approved design, not built

## Goal

Give every CaveCAD user one reliable, consistent way to send bug reports,
ideas and questions to the maintainer. Reports carry enough diagnostics to
act on — above all a log of *how* the user got into the situation — and
land in storage the maintainer already trusts with cave data.

## Audience and trust model

- **Senders:** anyone who downloads CaveCAD.
- **Readers:** the maintainer and people they explicitly trust with sensitive
  cave data. Reports may contain real entrance locations; that is accepted
  because the readership is closed.
- Everything lands in Google Drive owned by the official account
  **cavecad.app@gmail.com**, shared per person. Nothing lands on GitHub.
  GitHub issues are written by hand from triage rows and never link the
  Drive folder.

## Scope

In:

1. Session log (C++): a per-launch log file with action breadcrumbs.
2. Help > Send Feedback dialog and report package (script).
3. Transport, outbox and failure path (script).
4. Receiver: Google Apps Script web app, Drive folder, triage Sheet.
5. Removal of Help > Report Bug (currently opens qcad.org/bugreport).
6. About dialog gains a contact line, a Privacy link and a no-warranty line.
7. Privacy policy (`PRIVACY.md`, handbook page) and report retention.

Out: repointing the other qcad.org Help entries (separate task), GitHub
issue automation, sanitized-copy export, chunked uploads.

---

## 1. Session log

### Content

One timestamped line per event:

| Event | Example line |
|---|---|
| Session header (once) | CaveCAD build + commit, Cave Survey version, OS, GPU/OpenGL info, screen size and scale, locale |
| Action trigger | `[crumb] action: Feature Trace` |
| Document | `[crumb] open: /path/Pitfall.dxf (1832 entities)` — also new, save, save as, close |
| Undo / redo | `[crumb] undo: Move` |
| Script error | file, line, message |
| Qt messages | warning, critical, fatal (existing filters kept) |

Not logged: mouse clicks, coordinates, typed text.

### Mechanics

- `RMainWindow::messageHandler` keeps writing to stderr as today and also
  appends each line to `<app data>/logs/session-<yyyyMMdd-HHmmss>.log`,
  flushing after every line so a crash leaves the file complete.
- Breadcrumbs are emitted as `qInfo()` lines prefixed `[crumb]` from:
  the `RGuiAction` trigger path (covers every menu, toolbar, shortcut and
  Cave Survey tool), document new/open/save/save-as/close, and undo/redo.
  One pipe, one format.
- At launch: keep the newest **5** session logs, delete older ones.
- Per-file cap **2 MB**: when exceeded, drop the oldest half of the body;
  the session header is always kept.
- Lives entirely in `cavecad-src` C++; ships only with a full app build.

## 2. Dialog and report package

### Menu

Help > **Send Feedback…** in `scripts/Help/SendFeedback/`, alongside
CheckForUpdates. `setRequiresDocument(false)`. `scripts/Help/ReportBug/` is
deleted.

### Dialog

Qt widgets from a `.ui` file; no native dialogs anywhere (file pickers use
the Qt dialog).

- **Type:** Bug / Idea / Question.
- **Summary:** one line, required.
- **What happened / what you expected:** multi-line; required when Type is Bug.
- **Email:** optional, labelled "only if you want a reply".
- **Attach:**
  - ☑ Session logs (current and previous)
  - ☑ Screenshot of the CaveCAD window
  - ☐ My drawing (copy of the in-memory drawing)
  - ☐ Survey files — everything in the drawing's folder except image and PDF files
  - **Scans:** None (default) / Only scans used in this drawing / Choose scans…
  - Drawing, survey-file and scan options are disabled when no drawing is open.
- **Consent line** under the drawing options: *"Your drawing contains your
  cave's location. It goes only to the CaveCAD maintainer and people they
  trust."*
- **Size readout**, live, with the scan total shown separately. Warn at
  **20 MB** of zip, block sending above **30 MB** (base64 inflates by a
  third; this keeps the POST under Apps Script's limit).
- **Review…** opens the staging folder so the user sees exactly what will
  be sent.
- **Send** / **Cancel**.

### Scan hint

While the user types, the description is checked (case-insensitive) for:
`scan`, `sketch`, `image`, `picture`, `pdf`, `trim`, `outline`. On a match
while Scans is None, an inline notice appears: *"Sounds like a scan problem
— attaching the scan helps us reproduce it."* with buttons **Attach scans
used in drawing** and **Choose scan…**. Advisory only; nothing is attached
until the user clicks. The notice hides once any scan is attached.

"Scans used in this drawing" = the files referenced by the document's image
entities, read from the document itself (no dependency on the Cave Survey
add-on).

### Package

One zip per report: `feedback-<yyyy-MM-dd>-<id>.zip`, where `<id>` is 6
lowercase hex characters.

```
report.json        id, type, summary, description, email,
                   CaveCAD version + commit, Cave Survey version, OS,
                   active tool, open document names,
                   attachment list with sizes, consent flags
logs/              current and previous session logs
screenshot.png     main window, grabbed BEFORE the dialog opens
drawing.dxf        copy of the in-memory drawing (unsaved edits included);
                   the user's file, filename and modified flag untouched
cave/              survey files and chosen scans, relative paths preserved
```

Zipping uses `FeedbackCommands.zipCommand(system, staging, folder, zipPath)`
in `cavecad-src`, following the `CsPackage.zipCommand` pattern (ditto on
macOS, PowerShell `Compress-Archive` on Windows, `zip` elsewhere). Copied,
not imported: the app must never depend on the add-on.

## 3. Transport, outbox, failure path

### Sending

- Base64-encode the zip with `QByteArray.toBase64()`; if the script bridge
  lacks it, fall back to the platform `base64` / `certutil` tool.
- POST via `QProcess`, asynchronously, the same way the updater does:
  `curl -sS -L --proto =https --data-binary @report.b64 "<endpoint>?k=<key>&id=<id>"`
  (`curl.exe` on Windows). `-L` follows Apps Script's 302 redirect. No `-f`:
  the JSON reply is parsed even on a refusal. No `--retry`: a retried POST
  could file a duplicate report. Stalls, not overall duration, are what
  should cut this off, so `--speed-limit`/`--speed-time` do the timeout
  work instead of a fixed cap.
- The dialog shows a sending state, then on success:
  **"Sent. Reference `<id>`."**

### Configuration

- `scripts/Help/SendFeedback/FeedbackConfig.js` holds `ENDPOINT`, `KEY`
  and `EMAIL`. The repo copy holds placeholders; CI replaces `ENDPOINT` and
  `KEY` from GitHub Actions secrets at build time. `EMAIL` is
  `cavecad.app@gmail.com` in the repo.
- With placeholders (local dev builds), Send skips the POST, saves the zip
  and goes straight to the failure dialog, whose first line reads "Sending
  is not configured in this build." The email route still works.

### Outbox

- Unsent zips are kept in `<app data>/feedback/outbox/`.
- At each launch a background retry sends every outbox zip and deletes it
  on success. It never blocks startup.
- A per-file failure count is kept beside it. From the 3rd failed launch,
  the status bar shows *"1 feedback report waiting to send — Show…"*.

### Failure dialog

> **Couldn't send your feedback.**
> A copy is saved and CaveCAD will try again next time it starts.
> If you'd rather send it yourself, email the saved file to
> **cavecad.app@gmail.com**.
> **[Show file]** **[Write email]** **[OK]**

- **Show file** reveals the zip in Finder / Explorer.
- **Write email** opens `mailto:cavecad.app@gmail.com` with subject
  `CaveCAD Feedback <id>: <summary>` and a body asking the user to attach
  the shown file (mailto cannot attach).
- Zips over **25 MB** add: *"This file is too large to email — share it
  via Google Drive or Dropbox instead."*
- A report both emailed and later sent from the outbox shows up twice in
  the Sheet with the same ID; duplicates are visible by ID.

## 4. Receiver

Source in the repo at `tools/feedback-receiver/Code.gs`, deployed once by
the maintainer as a web app under **cavecad.app@gmail.com** ("execute as
me", "anyone" may access). Logic lives in pure functions; `doPost` is a thin
wrapper over Drive, Sheets and Mail.

`doPost(e)`:

1. Reject unless `k` matches the script property `KEY`, the body is at most
   **40 MB**, and fewer than **30** reports arrived in the last hour
   (counter in `CacheService`; a global brake, since Apps Script sees no
   client IP). Rejections return `{ok:false, error}`.
2. Decode base64, save the original zip, and unzip into
   `CaveCAD Feedback/<yyyy-MM-dd> <Type> — <summary, max 60 chars> (<id>)/`.
3. Append a row to the triage Sheet: Received, ID, Type, Summary, Email,
   CaveCAD version, OS, Attachments, Size, Folder link, **Status**
   (New / Triaged / Fixed / Won't fix, default New), Notes.
4. Email cavecad.app@gmail.com: subject
   `[CaveCAD Feedback] <Type>: <summary>`, body with the folder link and
   the report's version and OS.
5. Return `{ok:true, id}`.

The Drive folder and Sheet are shared per person — the maintainer's
personal account and anyone trusted. Anyone with access can read every
submitted cave.

## 5. About dialog

In `scripts/Help/About/About.js`, after the GPL paragraph, add:
*Contact: cavecad.app@gmail.com* (`mailto:` link), a **Privacy** link to
`PRIVACY.md` on GitHub, and *"Provided without warranty — see the
licence."* The GPL "Based on QCAD Community Edition" attribution stays.
(Commit 0d692308 already removed the QCAD contribute/shop links.)

## 6. Privacy policy

A one-page **notice**, not an agreement: nobody accepts anything to use
CaveCAD. It covers every point where CaveCAD talks to the internet.

### Delivered as

- `PRIVACY.md` at the repo root, linked from `README.md`.
- A handbook page (Cave Survey handbook) with the same text.
- A **Privacy** link in the About dialog.
- A **What we collect** link in the Send Feedback dialog, beside the
  consent line.

### Content (inventory verified 2026-09-27 against the source)

| Feature | Service contacted | What that service learns |
|---|---|---|
| Check for Updates | GitHub (`github.com` releases) | IP address, that CaveCAD checked. Nothing else sent. |
| Surface Data / aerial basemap | USGS National Map (`imagery.nationalmap.gov`, `elevation.nationalmap.gov`) | IP address and the **map area requested — i.e. roughly where the cave is** |
| Entrance Location picker | OpenStreetMap tiles (`tile.openstreetmap.org`), Esri World Imagery (`server.arcgisonline.com`), Leaflet library from `unpkg.com` | IP address and the **map area viewed** |
| Send Feedback | Google (Apps Script + Drive under cavecad.app@gmail.com) | Only what the user chose to send |

Stated plainly: the map-area requests are the privacy-sensitive ones for
cavers — the imagery and elevation providers see which area was fetched.
CaveCAD sends them no cave names or survey data.

Send Feedback terms:

- Collected: the items listed in section 2; everything beyond logs and
  screenshot is opt-in, and those two can be unticked.
- Purpose: fixing and improving CaveCAD only.
- Readers: the maintainer and named trusted helpers. Never published,
  sold or shared further.
- Storage: Google Drive under cavecad.app@gmail.com (Google as storage
  provider).
- Retention: 30 days after the report is closed, and at most **12 months**.
- Deletion: email cavecad.app@gmail.com with the reference ID.
- Drawings remain the sender's; sending one permits its use for debugging
  only.

Everything else stays local: drawings, survey data and session logs never
leave the computer unless the user sends them.

Contact: cavecad.app@gmail.com.

### Retention trigger

`Code.gs` gains `purgeOld()`, run daily by a time-driven trigger: moves to
Drive trash every report folder whose Sheet row has been Fixed or Won't fix for 30 days, and
every folder older than 12 months regardless of status, and marks the row
`Purged`. The 30 days count from a **Closed** date column, stamped by an `onEdit` trigger when Status changes to Fixed or Won't fix. Pure date/status logic tested under `node` with the rest.

### Maintenance rule

Any new feature that contacts a network service updates the table in
`PRIVACY.md` in the same change.

## Testing

**Session log (C++), headless via the existing engine-test route:**
action trigger writes a `[crumb] action:` line; open and save write
document lines; a forced `qFatal` leaves the last line on disk; six
launches leave five logs; a log over 2 MB is halved and keeps its header.

**Feedback core (pure JS):** `report.json` builder fields and consent
flags; size gate (pass <20 MB, warn 20–30, block >30); scan hint fires on
each keyword and hides once scans are attached; scans-used list from image
entities (Pitfall Cave fixture with scans); survey-file filter excludes
images and PDFs; `zipCommand` and curl command per platform; outbox failure
count and 3rd-launch notice; placeholder config skips the POST and reaches the failure
dialog.

**Receiver:** pure functions (key check, size/rate gate, folder name,
Sheet row, purge selection) tested under `node`.

**Live, via the CaveCAD MCP bridge** (after deploy + `codesign`, and after
a confirmed restart so the add-on isn't stale):
1. Send to a **test deployment**: folder, Sheet row and email arrive; the
   reference ID matches.
2. Unreachable endpoint: failure dialog shows Show file, Write email and
   the 25 MB note; relaunch against the test endpoint empties the outbox.
3. `screenshot.png` does not contain the dialog.
4. Attaching the drawing leaves the user's file mtime and modified flag
   unchanged.

**CI:** the built artifact's `FeedbackConfig.js` holds the real endpoint;
a grep test fails if the repo copy holds anything but the placeholder.

## Maintainer setup (one-time, manual)

1. Under cavecad.app@gmail.com: create the `CaveCAD Feedback` folder and
   triage Sheet; paste `Code.gs` into a new Apps Script project; set script
   properties `KEY`, `FOLDER_ID`, `SHEET_ID`; deploy as web app.
2. Add GitHub Actions secrets `FEEDBACK_ENDPOINT` and `FEEDBACK_KEY` to
   `Nate-the-Ace/cavecad-src`.
3. Share the folder and Sheet with the personal account and trusted people.
4. Make a second "test" deployment for live tests.
5. In the Apps Script project, add a daily time-driven trigger for
   `purgeOld` and an installable on-edit trigger for the Sheet (stamps the
   Closed date).
