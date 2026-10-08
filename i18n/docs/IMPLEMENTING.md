# Implementing translations in CaveCAD

How the code in `cavecad-tools` and `cavecad-src` has to be written so that
this repo can translate it, and how translations reach users. Everything
marked *verified* was tested against the installed CaveCAD, headless.

## How loading works (no code needed)

- CaveCAD's `scripts/autostart.js` (`loadTranslations`, ~line 249) walks every
  add-on and, if the add-on folder has a `ts/` subfolder, installs
  `<ClassName>_<locale>.qm` from it. For Cave Survey that is
  `scripts/CaveSurvey/ts/CaveSurvey_<locale>.qm`.
- `<locale>` comes from **Edit > Application Preferences > Language**, which is
  QCAD's stock setting. Nothing Cave Survey-specific.
- An installed translator answers for **every** context, not just its own
  add-on's. So one `.qm` covers every tool folder, `Core/`, and the fork's
  C++ 3D view (*verified*).
- `qsTr()` in a script uses the **file's basename** as its context -- the same
  context `lupdate` writes (*verified*: `Core/CsFoo.js` -> context `CsFoo`).
  Consequence: **renaming a file orphans its translations.** `extract.sh`
  marks them vanished rather than deleting them; move them by hand.
- `make_package.sh` copies the whole add-on folder, so a `ts/` inside it ships
  with no packaging change.

## Rules for code in cavecad-tools

`python3 tools/audit.py` reports every breach below. Once the backlog is at
zero, `audit.py --fail` can run in cavecad-tools' test suite so no new one lands.

1. **Wrap every string a user reads in `qsTr()`** -- buttons, labels,
   tooltips, status tips, command prompts, `handleUserMessage/Warning`, and
   undo-step names (`op.setText(...)`, shown in the Edit menu).
2. **The argument must be a literal.** `qsTr(someVar)` translates at runtime
   but `lupdate` cannot extract it, so it never gets a translation. Where a
   label is chosen by a helper (e.g. `CsScanList.markLabel`), put the `qsTr`
   on each literal inside the helper.
3. **Never glue fragments.** `qsTr("Found ") + n + qsTr(" stations")` fixes
   English word order. Write `qsTr("Found %1 stations").arg(n)`. For counts,
   `qsTr("%n station(s)", "", n)` gets proper plural forms per language
   (standard Qt; not yet tried in CaveCAD's script engine).
4. **Give short or ambiguous strings a disambiguation**:
   `qsTr("Plan", "map view")` vs `qsTr("Plan", "to schedule")`. Translators
   see the second argument; it becomes part of the lookup key.
5. **Do not translate data.** Tag keys (`Station`, `LRUDName`), layer names,
   command aliases (`setDefaultCommands`), settings keys, file names, and the
   `CaveSurvey` custom-property group stay English forever -- code looks them
   up by name and drawings carry them. Mark a line that looks like UI but is
   data with a trailing `// i18n-ok` so the audit skips it.
6. **Text written into a drawing** (legend titles, band labels) is a choice,
   not a rule: translate it at draw time with `qsTr` if the drawing should be
   in the user's language. It is then frozen in the DXF in that language.
7. **Numbers.** `parseFloat("12,5")` is `12` -- silently. Anywhere a user types
   a number, accept a comma decimal (e.g. replace `,` with `.` before
   parsing, in one shared Core helper) and show numbers with the user's
   decimal separator. Not yet built or tested in CaveCAD.
   The survey notebook is the high-risk spot. This is a data-integrity bug in
   comma-decimal countries whether or not the UI is translated.

## Rules for the fork's C++ (cavecad-src)

The 3D view (`src/gui/RCave3d*`) already uses `tr()` throughout. Keep it
that way; `extract.sh` puts those strings in `ts/Cave3D_<lang>.ts` and
`release.sh` compiles them into the same `CaveSurvey_<lang>.qm`. Stock QCAD
strings are translated by the fork's own `ts/cavecad*_<lang>.qm` (44
languages inherited from QCAD) and are not handled here.

## Shipping

1. `./tools/extract.sh` then translate `ts/*.ts` (Qt Linguist, or a platform
   that reads `.ts` such as Weblate/Crowdin).
2. `./tools/release.sh` -> `build/CaveSurvey_<lang>.qm`, plus a coverage line.
3. `python3 tools/smoke.py build/CaveSurvey_de.qm ts/*_de.ts` proves CaveCAD
   returns every finished translation.
4. On a **cavecad-tools branch made for it**:
   `./tools/ship.sh ../cavecad-tools/scripts/CaveSurvey`, commit the `.qm`
   files, then publish as usual.

Unfinished entries are left out of the `.qm`; CaveCAD shows English for them.

## Not covered yet

- **The handbook** (68 HTML pages, ~24k words) -- needs per-locale page
  folders with per-page English fallback, and screenshots per language.
- **The template DXF** -- layer names stay English (rule 5); any visible title
  text in it would need a per-language template.
- **Units default** -- metres vs feet could follow the locale.
