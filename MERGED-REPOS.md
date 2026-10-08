# One repository

This repository now holds everything that used to live in three:

| Folder | Was | Contents |
|---|---|---|
| (root) | `cavecad-src` | the CaveCAD application (C++ and scripts) |
| `cave-survey/` | `Nate-the-Ace/CaveCAD` (branch `legacy-map`) | the Cave Survey tools: `scripts/CaveSurvey`, tests, docs, packaging |
| `i18n/` | `Nate-the-Ace/cavecad-i18n` | translation catalogs and tools |

The full history of each came with it. The old repositories are archived;
make all changes here. Tool-only changes (`cave-survey/**`, `i18n/**`) do not
rebuild the app: `assemble.yml` repacks the latest build with the new tools.
Installed copies still update from this repository's `latest-build` release.
