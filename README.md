CaveCAD - 2D CAD for Cave Mapping
=================================

CaveCAD is a 2D CAD application for drawing cave surveys and maps, built as a
modified version of [QCAD Community Edition](https://qcad.org) by RibbonSoft
GmbH. It is not affiliated with or endorsed by RibbonSoft.

CaveCAD keeps QCAD's full 2D drafting core and adds cave-specific branding,
its own settings/data location (so it coexists with a regular QCAD install),
and is designed to host the Cave Survey tool suite (traverse plotting, survey
file import from Walls/Compass/Survex, LRUD passage walls, map fitting,
breakdown symbols, and georeferencing).

**Privacy:** see [PRIVACY.md](PRIVACY.md). Contact: cavecad.app@gmail.com

Download and updates
--------------------
Builds for Windows (x64 and ARM64), macOS (Apple Silicon) and Linux (x86_64
and aarch64) are published as the rolling pre-release
[latest-build](https://github.com/Nate-the-Ace/cavecad-src/releases/tag/latest-build),
each with the Cave Survey tools included.

A published build keeps itself up to date:

- A few seconds after starting, it checks `latest-build` quietly. When there
  is something newer it offers it: **Update now**, **Later** (ask again next
  start) or **Skip this version**. Offline or on any error it says nothing.
- **Help > Check for Updates** asks at any time and always answers.
- The startup check can be switched off in the prompt or in
  **Preferences > General > Updates**.
- When only the Cave Survey tools changed, only they are downloaded (about
  3 MB) and installed beside the app. When the app changed, the whole build
  is downloaded, and after CaveCAD quits a small helper swaps it in and
  starts the new one; answering "No" to the restart installs it at the next
  quit instead. Files of your own kept in the install folder are carried
  over.
- Every download is checked against its published SHA-256 checksum before
  anything is installed. This catches corrupt, truncated or altered
  downloads; it does not protect against someone able to replace both a file
  and its checksum on GitHub, which code signing will address.
- A build whose install folder cannot be written (for example under
  `Program Files`), and development builds, are not updated in place.

License
-------
CaveCAD's source code, like the QCAD 3 source code it is derived from, is
released under the GNU General Public License version 3 (GPLv3) with QCAD's
optional exceptions. See:

- [LICENSE.txt](LICENSE.txt) — overview of all licenses in this tree
- [gpl-3.0.txt](gpl-3.0.txt) — the GPLv3 license text
- [gpl-3.0-exceptions.txt](gpl-3.0-exceptions.txt) — QCAD's exceptions, which
  permit script add-ons and C++ plugins under their own licenses

All modifications made for CaveCAD are themselves licensed under GPLv3. Script
add-ons and C++ plugins are released under their respective licenses.

Source availability
-------------------
The complete, buildable source code for CaveCAD — including every modification
to upstream QCAD — is public at:

    https://github.com/Nate-the-Ace/cavecad-src (branch: cavecad)

Upstream QCAD source: https://github.com/qcad/qcad

Modifications from QCAD
-----------------------
See [NOTICE.md](NOTICE.md) for a summary of changes made to upstream QCAD, as
required by GPLv3 section 5(a). The authoritative record of every change is
the git history of the `cavecad` branch.

Trademarks
----------
"QCAD" is a product name of RibbonSoft GmbH. In accordance with QCAD's
distribution terms, this modified version is distributed under the distinct
name "CaveCAD" and is never distributed as "QCAD", "QCAD Professional" or
"QCAD/CAM". CaveCAD does not include any QCAD Professional or QCAD/CAM
components (no proprietary DWG plugin; DXF only).

History
-------
QCAD started as version 1 in October 1999 and has since evolved through
version 2 (September 2003) and the current version 3 (July 2012 to present).
CaveCAD forked from QCAD 3.33 in August 2026.

Compilation
-----------
Detailed compilation instructions for Windows, macOS and Linux can be found
on the QCAD web site at:

http://www.qcad.org/en/component/content/article/78-qcad/111-qcad-compilation-from-sources
