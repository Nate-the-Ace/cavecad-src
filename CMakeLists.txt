cmake_minimum_required(VERSION 3.16)

include(CMakeInclude.txt)

project(cavecad VERSION 1.0 LANGUAGES CXX)

set(PROJECT_ROOT_DIR ${PROJECT_SOURCE_DIR})

# CaveCAD: the application's own version number, kept in one place (the
# VERSION file at the repository root) and handed to the code as a macro.
# It is CaveCAD's version, not the QCAD framework version in RVersion.h,
# which keeps tracking upstream.
file(STRINGS "${PROJECT_SOURCE_DIR}/VERSION" CAVECAD_VERSION LIMIT_COUNT 1)
string(STRIP "${CAVECAD_VERSION}" CAVECAD_VERSION)
add_compile_definitions(CAVECAD_VERSION_STRING="${CAVECAD_VERSION}")
message(STATUS "CaveCAD version: ${CAVECAD_VERSION}")
# The same number as the four integers a Windows VERSIONINFO wants, in a
# header that every target's .rc reaches through shared.rc. The .exe and
# DLL file properties then read CaveCAD's version, not QCAD's 3.33.
string(REPLACE "." ";" CAVECAD_VERSION_PARTS "${CAVECAD_VERSION}")
list(APPEND CAVECAD_VERSION_PARTS 0 0 0 0)
list(GET CAVECAD_VERSION_PARTS 0 CAVECAD_VERSION_MAJOR)
list(GET CAVECAD_VERSION_PARTS 1 CAVECAD_VERSION_MINOR)
list(GET CAVECAD_VERSION_PARTS 2 CAVECAD_VERSION_REV)
list(GET CAVECAD_VERSION_PARTS 3 CAVECAD_VERSION_BUILD)
# its own folder: the build dir itself holds VERSION in an in-source build,
# which a case-insensitive filesystem serves up for <version>
file(WRITE "${CMAKE_BINARY_DIR}/generated/cavecad_version.h"
    "#define CAVECAD_VERSION_MAJOR ${CAVECAD_VERSION_MAJOR}\n"
    "#define CAVECAD_VERSION_MINOR ${CAVECAD_VERSION_MINOR}\n"
    "#define CAVECAD_VERSION_REV ${CAVECAD_VERSION_REV}\n"
    "#define CAVECAD_VERSION_BUILD ${CAVECAD_VERSION_BUILD}\n"
    "#ifndef CAVECAD_VERSION_STRING\n"
    "#define CAVECAD_VERSION_STRING \"${CAVECAD_VERSION}\"\n"
    "#endif\n")
include_directories("${CMAKE_BINARY_DIR}/generated")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
    "${PROJECT_SOURCE_DIR}/VERSION")

option(BUILD_QT6 "Building with Qt 6.x" ON)

add_subdirectory(src)
