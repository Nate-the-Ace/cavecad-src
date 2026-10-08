# Reset Drawing -- design

Date: 2026-09-13
Status: approved, ready to plan

## The problem

Teaching a class on the suite means handing every student the same
starting point, repeatedly: a cave folder whose images are already in
place -- the georeferenced aerial under the map, the sketch scans
trimmed, warped and anchored where the caver drew them -- and whose
drawing is otherwise empty, so the lesson can start at "import the
survey" and run through to a finished map.

Testing wants the same thing for the same reason: a project to wipe and
re-run a tool against, without re-fetching an aerial or re-fitting
forty-seven scans every time.

Nothing does this today. Teaching Cave resets a whole FOLDER from a
pristine master (CsTeach), which is the right tool for handing out a
cave and the wrong one for emptying the drawing you already have open.

## What a reset is

FULL, and full means full. Nothing in the drawing survives:

  * the survey -- stations, legs, splays, LRUD, trip metadata;
  * the drawn map -- traced linework, shaped lines, symbols, area
    fills, callouts, notes, profile bands, cross sections;
  * the PLACED IMAGES -- every sketch scan and the aerial basemap;
  * the georeference, which rides an entity and goes with it.

The first design of this tool kept the images and carried the
georeference across on a marked point. That was wrong, and the reason it
was wrong is the reason the tool exists: placing a scan, fitting it,
trimming it and fetching the aerial are each a tool a student is here to
learn, exactly as importing the survey is. A reset that left them
standing would skip those lessons as surely as one that left the
stations behind would skip the first.

Then the layer table is brought back to the current template
(CsRestyle.ensureAndApply), so a class does not start on the previous
student's stray layers.

## What goes with it, outside the drawing

A drawing is not the whole of what a class carries forward. Three
pieces of per-cave state live in application settings and in the folder,
and each would hand the next student somebody else's progress:

  * the COMPLETE MARKS on this cave's scans
    (CaveSurvey/SketchScansBookmarks, keyed by the scans folder's own
    path) -- otherwise a student opens Sketch Scans and finds the pages
    already ticked off;
  * the LAST-DECLARED LOCATION (CaveSurvey/LastLocationLat/Lon). The
    anchor died with the drawing, but this is what Set Cave Location
    offers as its default, so the entrance would still be a keystroke
    away from a drawing that is supposed to have no location yet. It is
    application-wide rather than this cave's alone, and clearing it is
    the point: the setting exists to carry a coordinate between
    drawings, and carrying one out of a reset is exactly what it must
    not do.
  * the MAP THUMBNAIL, images/<Cave> preview.png -- otherwise the shelf
    card shows a picture of the map that was just deleted until the next
    save.

The SHELF ENTRY stays, deliberately: the cave should be one click away
afterwards so trips can be added to it straight away. Check Map's ignore
list stays too; it was not asked for.

None of the three can fail the reset. The drawing is already empty by
the time they run, and a settings write that will not land is not a
reason to leave a caver looking at a half-reported result -- so each is
attempted independently and the report names only what actually went.

## What is NOT touched

The cave's FOLDER. scans/, images/, lidar/, PDF/ and backup/ come
through exactly as they were, so every page, photograph, capture and
plotted map is still there to be placed again. This tool empties a
DRAWING and never a folder; Teaching Cave (CsTeach) is the one that
resets a folder, from a pristine master.

That distinction is what makes the reset survivable. The expensive part
of a cave project is the material on disk, not the placement of it.

## Why not just make a new drawing

Because a cave project is a folder whose drawing has a name, a backup
history, a shelf entry, and a path that every scan is stored relative
to. A new drawing is a new file somewhere else. The reset keeps all of
that and empties what is inside it.

It also works IN PLACE for a second reason: a drawing that changes
folders loses the relative paths its scans are stored against.

## Guards, in order

1. No document, or a drawing that has never been saved -- refuse.
   There is no folder to back up into.
2. Not inside a cave project folder (CsCave.folderOf) -- refuse.
3. A sheet file -- refuse (CsSheetFile.blocks), as every drawing tool
   in the suite does.
4. Nothing to delete -- say the drawing is already clear, and stop.
5. Backup. CsBackup.copyPrevious must return true. NO BACKUP, NO WIPE:
   this ordering, not the dialog, is the actual safety property.

The backup copies the file ON DISK, so unsaved changes in the open
drawing are not in it. The dialog says so rather than silently
implying otherwise.

## The progress window

A reset of a real cave takes several seconds: the backup is a file copy
that may cross Google Drive, and the drawing is a thousand entities and
a layer table. Several seconds of a frozen window is indistinguishable
from a crash, and a caver who believes a tool has crashed force-quits
it -- which is the one thing that could actually cost them work here.

So every phase says what it is doing, by name and by count: copying the
backup, counting the drawing, then removing the survey data, the drawn
linework and the placed images -- the same three numbers the
confirmation quoted, so somebody watching recognises what they agreed to
-- then restoring the layers and clearing the marks. The apply that
follows the walk is one call nothing can subdivide, so it is announced
rather than counted, instead of leaving a bar sitting at 99%.

NO CANCEL BUTTON. Stopping half way leaves a drawing that is neither the
map it was nor the blank it was going to be, and the recovery -- close
without saving -- is the same either way. A button that makes things
worse is not a kindness.

The window is hidden while the confirmation is up, and the whole thing
degrades to nothing: a progress window that cannot be built must never
stop a reset that can.

Bridge facts, probed live: QProgressDialog constructs, but QProgressBar's
minimum/maximum/value are READ-ONLY as properties -- setMinimum/
setMaximum/setValue are the only way in. Assigning to .value fails
silently, which would leave the bar at zero for the whole run: worse
than no bar, because a stuck bar says "hung" out loud.

## The dialog

Title: `Reset Drawing -- <Cave>`.

Body, in order: what goes, counted in three numbers -- survey, drawn,
and PLACED IMAGES counted apart, because somebody who has just spent an
evening fitting forty-seven scans deserves to see that number before
agreeing rather than a total that hides it; the line saying the location
goes too and comes back from Set Cave Location; what is NOT touched (the
folder, and everything on disk in it); the backup path just written;
and, where the drawing is modified, the line about unsaved changes.

Confirmation is typed: a line edit, and OK stays disabled until the
text matches the cave's name, trimmed and case-insensitive. Default
button is Cancel. A reset in front of a class must not be one stray
Return away.

Afterwards the drawing is left open and dirty. The tool saves nothing;
the student decides.

## Structure

`Core/CsReset.js` -- pure, node-testable:

  * `keepsEntity(info)` -- false, always. It exists so the rule is
    written down in one place with its reason attached, rather than
    being the absence of a filter in the middle of the walk, and so the
    walk and the count cannot drift apart if it ever changes.
  * `countKind(info)` -- "image" for a placed image wherever it sits,
    else "survey" for a CTRL- layer and "drawn" for the rest.
  * `tally(infos)` -- {total, survey, drawn, images}.
  * `planReset(state)` -> `{can, reason, warning}`, the shape
    CsTeach.planReset already uses: a refusal comes back as words a
    student can act on, never as a throw.
  * `summaryText`, `doneText`, `matchesName`, `groupNumber`.

`ResetDrawing/ResetDrawing.js` -- presenter and document work:

  * `classify(doc)` -- walks model space (not block definitions: a
    symbol's DEFINITION is not drawing content, and emptying those
    would empty the symbol library), splits ids from counts.
  * `withEveryLayerEditable` -- clears off, frozen AND locked on every
    layer for the delete, and puts each back. Locked is deliberately
    cleared here where CsLayers.withLayersOn will not: a locked layer
    refuses a delete in SILENCE, so the drawing would come back looking
    emptied while whatever was protected quietly survived.
  * `buildConfirm` / `confirm` -- split so the dialog can be built and
    inspected without a modal exec blocking the application.
  * `deleteAll`, `caveFolderOf`, `init(basePath)`.

Nothing outside these two files changes.

## Not doing

Block purging and sheet-layout clearing. Sheets are separate files
(CsSheetFile) so there are no layouts to clear, and purging blocks
would take symbol definitions the palette expects to find.

A "keep the survey, wipe the drawn work" mode, and a "keep the images"
mode. Asked and answered: the reset is full.

## Testing

Unit tests in tests/js_unit.js over the pure half: keepsEntity over
images and non-images alike, countKind's three-way split, the tally,
planReset through each refusal and the go case, matchesName, and every
line the dialog promises -- the image count, the location line, and the
sentence saying the folder is not touched.

CsReset.js must be added to the harness's hand-written Core file list.
A Core file missing from that list does not fail -- it passes silently
through the harness's deliberate catches, and every test that needed it
is quietly skipped.

Engine test tests/reset_drawing_run.js (stage 11/44): a real document
with a survey, two placed images, a georeferenced anchor station, a wall
on a LOCKED layer and an aerial on an OFF one. After the reset: not one
entity left, no image, no anchor, the scanned page still on disk, the
template's layers back, and the locked and off layers restored to how
they were. A second run finds nothing and the tool refuses.

Live GUI check on a teaching copy: reset, confirm the drawing is empty
and the cave folder is not.
