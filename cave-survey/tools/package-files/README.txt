Cave Survey tools for CaveCAD -- version @VERSION@
==============================================================

Tools for drawing cave surveys in CaveCAD: import survey files from
Walls, Compass or Survex, fit a scanned map onto the drawing, scatter
breakdown symbols, and georeference the finished map.

To install, see INSTALL.txt. After a restart the tools are in the
"Cave Survey" menu, and each also answers to a name typed on CaveCAD's
command line.


THE TOOLS
---------

Import Native Cave Survey                   importcavesurvey, ics
    Reads a Walls (.srv), Compass (.dat) or Survex (.svx) file directly
    and draws the centerline, stations and LRUD ticks.

Align Image                                 alignimage, ali
    Fits a scanned map onto the drawing. You click two points on the
    scan and the two matching points in the drawing, and the scan is
    moved, rotated and resized so they line up exactly -- then you can
    trace passage walls off it. See docs/AlignImage.txt.

Scatter Breakdown                           scatterbreakdown, scb
    Fills closed BREAKDOWN-BOUNDARY polylines with randomized breakdown
    symbols.

Geo Anchor                                  geoanchor
    Moves and scales the whole drawing so one station sits at a real
    latitude and longitude.


STARTING A MAP
--------------
Open templates/NSS_Cave_Template_PLAN.dxf and save it under your own
name. The tools draw onto its CTRL- layers:

    CTRL-SHOTS             centerline shot lines
    CTRL-STATIONS          station point symbols
    CTRL-STATION-LABELS    station names and elevations
    CTRL-LRUD              LRUD tick lines, and up/down text
    CTRL-LRUD-WALL-LEFT    approximate wall either side of the passage,
    CTRL-LRUD-WALL-RIGHT     from the LRUD ticks and the splays; dashed,
                             because it is an approximation, not a wall
                             you traced

The elevation is drawn into the same drawing, below the plan, on the
PROFILE- and CTRL-PROFILE- layers -- there is no separate profile
template.

The template is in feet, which is what the tools assume -- see below.


CONVENTIONS
-----------
These hold across every tool here, and are worth knowing before you
trust a plotted map.

  * Azimuth is degrees clockwise from North: 0 = N, 90 = E.

  * Distance is treated as already horizontal. Inclination only affects
    the elevation recorded in a station's label, never where the
    station is plotted. If your data is slope distance, correct it
    before importing.

  * Distances are converted to feet on import, to match the templates.
    Each format's own default applies: Survex metres, Walls feet,
    Compass always feet. If you work in metres, change
    DRAWING_DISTANCE_UNIT near the top of
    CaveSurvey/ImportNativeCaveSurvey/ImportNativeCaveSurvey.js.

  * L and R are measured facing the direction of travel, and a shot's
    LRUD belongs to its To station.

  * Declination declared inside a file is applied on import for
    Compass (DECLINATION:) and for Walls (#Units Decl=). Survex's
    *calibrate declination is NOT read -- an .svx that relies on it
    comes in rotated by that amount, so correct the bearings in the
    file, or rotate the drawing afterwards.


TRYING IT WITHOUT YOUR OWN DATA
-------------------------------
examples/ holds the same short survey written three ways:

    TestCave_Walls.srv       Walls
    TestCave_Compass.dat     Compass
    TestCave_Survex.svx      Survex

Open a template, run Import Native Cave Survey, and pick one. All three
should draw the same cave.


LICENCE AND SOURCE
------------------
See LICENSE. Source and issue tracker:
https://github.com/ndschonegg/CaveCAD

Built @BUILD@ from @COMMIT@.
