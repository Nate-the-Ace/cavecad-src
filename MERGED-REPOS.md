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

## The built-in updater

It still reads `latest.json` from this repository's `latest-build` release (the address is fixed in
`scripts/Help/CheckForUpdates/CcUpdateCore.js`), so installed copies keep updating with no change.
- An **app** update is offered when the build's commit (`cavecad-build.json`) differs from the published one.
  Tool-only changes do not rebuild the app, so they never look like an app update.
- A **tools** update is offered only when `cave-survey/VERSION` goes up. Bump it with every tools change you
  want people to get. The build warns if the tools changed but the version did not.
- The macOS **test build** marks itself as a development build, so the updater leaves it alone.
