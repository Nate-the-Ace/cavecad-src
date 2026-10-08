# cavecad-i18n

Translations for CaveCAD's Cave Survey add-on and 3D view, and the tools
that build them. Uses Qt's own pipeline (`lupdate` / `lrelease` / `.ts` /
`.qm`), because CaveCAD already loads `.qm` files for every add-on.

This repo **reads** `../cavecad-tools` and `../cavecad-src` and never writes
to them, except `tools/ship.sh`, which only writes where you point it.

## Layout

    languages.txt        which languages have catalogs
    ts/                  the catalogs translators edit (committed)
      CaveSurvey_<l>.ts    qsTr() strings from the add-on's JS
      Cave3D_<l>.ts        tr() strings from the fork's 3D view C++
    glossary/            cave-survey terms and how to treat them
    docs/IMPLEMENTING.md rules for writing translatable code, and shipping
    tools/
      extract.sh         source -> ts/ (keeps existing translations)
      release.sh         ts/ -> build/CaveSurvey_<l>.qm, prints coverage
      smoke.py           proves a .qm translates inside headless CaveCAD
      audit.py           lists add-on strings that can't be translated yet
      ship.sh            copies build/*.qm into an add-on's ts/ folder
    tests/run.sh         end-to-end test against a fixture add-on

## Everyday use

    ./tools/extract.sh                       # after source changes
    # translate ts/*.ts in Qt Linguist:  open -a Linguist ts/CaveSurvey_de.ts
    ./tools/release.sh
    python3 tools/smoke.py build/CaveSurvey_de.qm ts/*_de.ts
    python3 tools/audit.py --only UNWRAPPED  # the wrapping backlog

Add a language: add its code to `languages.txt`, run `extract.sh`.
Requires `brew install qt` and `/Applications/CaveCAD.app` (for smoke.py).
Override paths with `TOOLS_SRC`, `CAVECAD_SRC`, `CAVECAD_BIN`.

## State (2026-09-25)

- 955 strings extracted (891 add-on, 64 3D view); catalogs for de, es, fr;
  nothing translated yet.
- Audit backlog in cavecad-tools: 169 unwrapped UI strings, 6 dynamic
  `qsTr(var)`, 89 glued fragments, and the comma-decimal number parsing.
- Not started: handbook translation, locale-aware units.

See `docs/IMPLEMENTING.md` for how it all fits.
