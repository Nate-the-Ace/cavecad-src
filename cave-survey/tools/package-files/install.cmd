@echo off
rem
rem Installs the Cave Survey tools into CaveCAD, for Windows.
rem
rem   install.cmd              install, or upgrade over an older copy
rem   install.cmd --uninstall  remove them again
rem
rem This copies the CaveSurvey folder into CaveCAD's per-user scripts folder.
rem That location needs no administrator rights and survives a CaveCAD update.
rem Everything it does can be done by hand instead -- see INSTALL.txt.

setlocal
set "HERE=%~dp0"
set "SOURCE=%HERE%CaveSurvey"
set "SCRIPTS=%APPDATA%\QCAD\CaveCAD\scripts"
set "DEST=%SCRIPTS%\CaveSurvey"

if /i "%~1"=="--uninstall" goto uninstall
if not "%~1"=="" goto usage

if not exist "%SOURCE%\CaveSurvey.js" (
    echo Can't find CaveSurvey\CaveSurvey.js next to this script.
    echo Run install.cmd from inside the unpacked package folder.
    goto fail
)

rem A previous install is replaced outright rather than merged, so that a tool
rem dropped from a later release doesn't linger in the menu.
if exist "%DEST%" (
    echo Replacing the existing install at:
    echo   %DEST%
    rmdir /s /q "%DEST%"
)

if not exist "%SCRIPTS%" mkdir "%SCRIPTS%"
xcopy "%SOURCE%" "%DEST%" /E /I /Q /Y >nul
if errorlevel 1 goto fail

echo.
echo Installed into:
echo   %DEST%
echo.
echo Tools installed:
for /d %%T in ("%DEST%\*") do echo   %%~nxT
echo.
echo Now quit CaveCAD completely and start it again -- it only looks for
echo add-ons at startup. Look for "Cave Survey" in the menu bar.
goto done

:uninstall
if exist "%DEST%" (
    rmdir /s /q "%DEST%"
    echo Removed %DEST%
    echo Restart CaveCAD; the Cave Survey menu will be gone.
) else (
    echo Nothing to remove -- not installed at %DEST%
)
goto done

:usage
echo usage: install.cmd [--uninstall]
goto fail

:fail
echo.
pause
exit /b 1

:done
echo.
pause
exit /b 0
