cmake_minimum_required(VERSION 3.16)

include(../../CMakeInclude.txt)

project(cavecadgui VERSION 1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(${QT_VER} REQUIRED COMPONENTS Core Widgets Concurrent Gui Network OpenGL OpenGLWidgets Sql Svg Xml PrintSupport Qml)
qt_standard_project_setup()

if(WIN32)
    set(RC gui.rc)
endif()

if (CMAKE_BUILD_TYPE STREQUAL "Release")
    link_directories(${CMAKE_CURRENT_SOURCE_DIR}/../../release)
else()
    link_directories(${CMAKE_CURRENT_SOURCE_DIR}/../../debug)
endif()

add_library(cavecadgui SHARED
    RCharacterWidget.cpp RCharacterWidget.h
    RCadToolBar.cpp RCadToolBar.h
    RCave3dBridge.cpp RCave3dBridge.h
    RCave3dLegend.cpp RCave3dLegend.h
    RCave3dCard.cpp RCave3dCard.h
    RCave3dLabels.cpp RCave3dLabels.h
    RCave3dEncoder.h
    RCave3dTexture.cpp RCave3dTexture.h
    RCave3dView.cpp RCave3dView.h
    RCave3dPanel.cpp RCave3dPanel.h
    RCadToolBarPanel.cpp RCadToolBarPanel.h
    RColumnLayout.cpp RColumnLayout.h
    RCloseCurrentEvent.h
    RColorCombo.cpp RColorCombo.h
    RComboBox.cpp RComboBox.h
    RCommandLine.cpp RCommandLine.h
    RDockWidget.cpp RDockWidget.h
    REventFilter.cpp REventFilter.h
    RToolOptionEventFilter.cpp RToolOptionEventFilter.h
    REventHandler.cpp REventHandler.h
    RFileSystemModel.cpp RFileSystemModel.h
    RFlowLayout.cpp RFlowLayout.h
    RFocusFrame.cpp RFocusFrame.h
    RFontChooserWidget.cpp RFontChooserWidget.h
    RGraphicsSceneDrawable.cpp RGraphicsSceneDrawable.h
    RGraphicsSceneQt.cpp RGraphicsSceneQt.h
    RGraphicsViewImage.cpp RGraphicsViewImage.h
    RGraphicsViewWorker.cpp RGraphicsViewWorker.h
    RGraphicsViewWorkerPainter.cpp RGraphicsViewWorkerPainter.h
    RGraphicsViewQt.cpp RGraphicsViewQt.h
    RLinetypeCombo.cpp RLinetypeCombo.h
    RLinetypeComboDelegate.cpp RLinetypeComboDelegate.h
    RLineweightCombo.cpp RLineweightCombo.h
    RListView.cpp RListView.h
    RListWidget.cpp RListWidget.h
    RMainWindowQt.cpp RMainWindowQt.h
    RMathComboBox.cpp RMathComboBox.h
    RMathLineEdit.cpp RMathLineEdit.h
    RMdiArea.cpp RMdiArea.h
    RMdiChildQt.cpp RMdiChildQt.h
    RRulerQt.cpp RRulerQt.h
    RShortcutLineEdit.cpp RShortcutLineEdit.h
    RTextEdit.cpp RTextEdit.h
    RToolButton.cpp RToolButton.h
    RToolMatrixItemDelegate.cpp RToolMatrixItemDelegate.h
    RTreeWidget.cpp RTreeWidget.h
    ${RC}
)

target_include_directories(cavecadgui PUBLIC
    ../../src/3rdparty
    ../../src/core
    ../../src/core/math
    ../../src/entity
    ../../src/gui
)

target_compile_definitions(cavecadgui PRIVATE
    QCADGUI_LIBRARY
    QCAD_DLL
)

if (CMAKE_BUILD_TYPE STREQUAL "Release")
    set_target_properties(cavecadgui PROPERTIES LIBRARY_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../../release)
    set_target_properties(cavecadgui PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../../release)
    set_target_properties(cavecadgui PROPERTIES ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../../release)
else()
    set_target_properties(cavecadgui PROPERTIES LIBRARY_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../../debug)
    set_target_properties(cavecadgui PROPERTIES RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../../debug)
    set_target_properties(cavecadgui PROPERTIES ARCHIVE_OUTPUT_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/../../debug)
endif()

# The system's own H.264 encoder: no encoder to ship, none to license.
if(APPLE)
    # Compiled as Objective-C++ by FLAG rather than by enabling the
    # OBJCXX language: enable_language() in a subdirectory leaves
    # CMAKE_OBJCXX_COMPILE_OBJECT unset and the generate step fails,
    # and adding the language to the top-level project would touch
    # every target in the tree for the sake of one file.
    set_source_files_properties(RCave3dEncoderMac.mm PROPERTIES
        LANGUAGE CXX
        COMPILE_FLAGS "-x objective-c++ -fno-objc-arc")
    target_sources(cavecadgui PRIVATE RCave3dEncoderMac.mm)
    target_link_libraries(cavecadgui PRIVATE
        "-framework AVFoundation"
        "-framework CoreMedia"
        "-framework CoreVideo"
        "-framework Foundation"
    )
else()
    target_sources(cavecadgui PRIVATE RCave3dEncoderNone.cpp)
endif()

target_link_libraries(cavecadgui PUBLIC
    Qt::Concurrent
    Qt::Core
    Qt::Gui
    Qt::Widgets
    Qt::Network
    Qt::OpenGL
    Qt::OpenGLWidgets
    Qt::Sql
    Qt::Svg
    Qt::Xml
    cavecadcore
    cavecadentity
)
