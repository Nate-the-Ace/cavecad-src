@echo off
rem Locate the installed Visual Studio and enter its build environment.
rem VCVARS_ARCH picks the toolset: 64 (x64, the default) or arm64.
if "%VCVARS_ARCH%"=="" set VCVARS_ARCH=64
for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -property installationPath`) do set VSPATH=%%i
if "%VSPATH%"=="" (
    echo vswhere could not locate a Visual Studio installation
    exit /b 1
)
call "%VSPATH%\VC\Auxiliary\Build\vcvars%VCVARS_ARCH%.bat"
