NOTICE — Modifications from upstream QCAD
=========================================

CaveCAD is a modified version of QCAD Community Edition 3.33
(https://github.com/qcad/qcad), Copyright (c) 2011-2026 RibbonSoft GmbH.
CaveCAD is not affiliated with or endorsed by RibbonSoft GmbH.

This file summarizes the modifications, as required by GPLv3 section 5(a).
The complete, authoritative record of every change (with dates and diffs) is
the git history of the `cavecad` branch at:

    https://github.com/Nate-the-Ace/cavecad-src

Summary of modifications (August 2026 onward)
---------------------------------------------
- Rebranded the application as "CaveCAD": application name, macOS bundle
  name/display name, and settings file (CaveCAD3.ini), giving it a per-user
  data and scripts location separate from any QCAD install on the same
  machine (src/run/main.cpp, src/run/Info.plist).
- New CaveCAD logo, application icon, and splash screen, with a QCAD
  attribution line on the splash screen.
- Repackaged script resource lists to match the CaveCAD script set
  (src/scripts/scripts.qrc, src/scripts/scripts_release.qrc).
- Documentation updated for CaveCAD (README.md, readme.txt, this file).
- Completed the rename of QCAD-named build artifacts and files: application
  bundle and executable (CaveCAD.app/CaveCAD), bundle identifier
  (org.cavecad.CaveCAD), shared libraries and plugins (libqcad* to
  libcavecad*), translation files (ts/qcad* to ts/cavecad*), icons,
  Windows version resources, desktop entry, man page, and Doxygen project.
  Internal QCAD API names (R-prefixed classes, R_QCAD_VERSION_* macros,
  QCAD_DLL) and GPL attribution headers are unchanged.

What is NOT included
--------------------
CaveCAD contains no QCAD Professional or QCAD/CAM components. In particular,
the proprietary DWG plugin is not included; file exchange is DXF (via dxflib,
GPL) only.

Licensing of modifications
--------------------------
All CaveCAD modifications to the QCAD source tree are licensed under the
GNU General Public License version 3 (see gpl-3.0.txt), consistent with the
upstream license (see LICENSE.txt and gpl-3.0-exceptions.txt).

The Cave Survey tool suite (script add-ons) is developed and distributed
separately under its own license, as permitted by QCAD's GPL exceptions.
