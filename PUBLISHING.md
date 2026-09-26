Publishing checklist — GPL compliance
=====================================

Run through this before shipping any CaveCAD binary (DMG, zip, installer):

1. **Ship the license files.** Every binary package must contain:
   - LICENSE.txt
   - gpl-3.0.txt
   - gpl-3.0-exceptions.txt
   - NOTICE.md
   - readme.txt

2. **Push first.** The exact source used for the build must be public on the
   `cavecad` branch at https://github.com/Nate-the-Ace/cavecad-src *before* binaries
   go out. Tag the release commit (e.g. `cavecad-v1.0`) so the binary can be
   matched to its source.

3. **Keep the name clean.** The app, package, and any web page say
   "CaveCAD", never "QCAD", "QCAD Professional" or "QCAD/CAM" as the
   product name. Attribution ("based on QCAD by RibbonSoft") is fine and
   already on the splash screen.

4. **No proprietary QCAD components.** Do not bundle the QCAD Professional
   DWG plugin or any QCAD/CAM files. DXF only.

5. **Update NOTICE.md** if the release adds notable modifications to the
   QCAD core beyond what is already listed.

6. **Preserve copyright headers.** Never strip RibbonSoft copyright notices
   from source files. When modifying a core file substantially, keep the
   original header and add a CaveCAD modification line below it.

Cave Survey plugin suite: separate codebase, its own license (permitted by
QCAD's GPL exceptions). Its packaging is handled by the suite's publish.sh
and is not covered by this checklist, except: if a CaveCAD binary package
bundles the suite, include the suite's license file too.
