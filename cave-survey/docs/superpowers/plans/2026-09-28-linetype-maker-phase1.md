# Linetype Maker, Phase 1 (dashes + text) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make, edit and import regular and text linetypes in CaveCAD, stored as true DXF complex linetypes that survive save and reopen.

**Architecture:** The engine (cavecad-src, branch `cavecad`) learns to read and write the complex LTYPE element codes and stops refusing complex patterns. The add-on (cavecad-tools, branch `linetype-maker`) gets a pure pattern model (`CsLinetype`), an engine-side store (`CsLinetypeStore`) over a personal `.lin` library, and a docked Linetype Maker panel.

**Tech Stack:** C++/Qt6 (dxflib, RDxfImporter/Exporter), QCAD ECMAScript add-on, CaveCAD headless test harness (`-no-gui -autostart`), node for pure tests.

**User decisions (already made):**
- "True linetypes" — native DXF complex LTYPE, not generated geometry.
- Glyphs: draw in CaveCAD AND import (.lin, .shp, .shx, DXF/DWG) — shapes are Phase 2.
- "Template + drawing" library; adapted per the Symbol Palette lesson: customs live in `~/Documents/Cave/linetypes/`, pushed into every new drawing by the template pour.
- Glyphs embedded in each drawing (Phase 2).
- "A phased per C": Phase 1 = dashes + text.
- "go ahead with minimal input. i trust your process."

**Spec:** `docs/superpowers/specs/2026-09-28-linetype-maker-design.md`

---

## Engine facts the tasks depend on (read 2026-09-28)

- `src/core/RLinetypePattern.cpp:446` refuses any `[...]` element unless a DWG plugin is loaded.
- dxflib treats group code **9** as a record boundary everywhere (`dl_dxf.cpp:397`, `groupCode==0 || groupCode==9`). Inside an LTYPE record, code 9 is the embedded TEXT string, so a text linetype ends its own record early. Must be scoped to non-LTYPE records.
- `DL_Dxf::handleLinetypeData` keeps only code 49. `RDxfImporter` accumulates dashes in `pattern` and consumes them in `addLinetype` (called when the NEXT record starts).
- `RImporter::importObjectP` adds to a transaction that stores the same `QSharedPointer`; mutating that linetype after `dxflib.in()` returns is how 340 → STYLE gets resolved (STYLE records come after LTYPE).
- `DL_Writer::handle()` writes and increments `m_handle`; STYLE is written after LTYPE, so style handles must be reserved first.
- R2000 `writeStyle` writes code 3 empty and puts the font in ACAD XDATA 1000; `RDxfImporter::addTextStyle` reads that fallback.
- `RExporter` places a glyph at the END of the dash or gap it follows (`RExporter.cpp:1321`).
- DXF LTYPE code 50 is radians; `.lin` `R=` is degrees (engine converts).
- The engine's `.lin` element regex takes text as `[^, ]*`: embedded text cannot contain spaces or commas.
- Build: `ninja` in cavecad-src builds `debug/libcavecadcore.dylib` and `plugins/libcavecaddxf.dylib`. Deploy copies into `/Applications/CaveCAD.app/Contents/{Frameworks,PlugIns}` then `codesign --force --deep --sign -`. No header change here is included by qcadjsapi, so no second build tree.

---

### Task 1: Engine reads complex linetypes

**Goal:** A DXF LTYPE with an embedded text element imports with its text, font, scale, rotation and offset, and records after it still import.

**Files:**
- Create: `cavecad-tools/tests/linetype_roundtrip_run.js`
- Modify: `cavecad-tools/tests/run_all.sh` (new stage)
- Modify: `cavecad-src/src/core/RLinetypePattern.cpp:446-448`
- Modify: `cavecad-src/src/3rdparty/dxflib/src/dl_entities.h` (DL_LinetypeElement, DL_LinetypeData.elements, DL_StyleData.handle)
- Modify: `cavecad-src/src/3rdparty/dxflib/src/dl_creationinterface.h` (addLinetypeDashElement)
- Modify: `cavecad-src/src/3rdparty/dxflib/src/dl_dxf.cpp` (397, handleLinetypeData, addTextStyle)
- Modify: `cavecad-src/src/io/dxf/RDxfImporter.h`, `RDxfImporter.cpp`

**Acceptance Criteria:**
- [ ] Hand-written DXF: linetype `CSTEXT` has 3 dashes, text `CAVE` at index 1, font `standard`, scale 0.1, offset (-0.1,-0.05)
- [ ] The LINE after the LTYPE table imports with linetype `CSTEXT`
- [ ] `RLinetypePattern.setPatternString` accepts a text element in CaveCAD
- [ ] Stage prints `### LINETYPE ROUNDTRIP OK`

**Verify:** `/Applications/CaveCAD.app/Contents/MacOS/CaveCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/linetype_roundtrip_run.js "$PWD"` → `### LINETYPE ROUNDTRIP OK`

**Steps:**

- [ ] **Step 1: Write the failing test** `tests/linetype_roundtrip_run.js` (read half; Task 2 appends the write half before the final OK):

```js
/**
 * Complex linetypes -- a text or shape drawn into the pattern -- used to be
 * refused by the engine (a DWG-plugin gate) and cut down to bare dashes by
 * the DXF reader and writer. This drives both directions against the real
 * engine. The first half reads a HAND-WRITTEN file, so it tests the reader
 * rather than whatever the exporter happens to emit.
 */
function fail(msg) {
    print("### LINETYPE ROUNDTRIP FAILED: " + msg);
    QCoreApplication.exit(1);
    throw msg;
}
function check(cond, msg) {
    if (!cond) {
        fail(msg);
    }
}
function near(a, b, msg) {
    check(Math.abs(a - b) < 1e-6, msg + " (expected " + b + ", got " + a + ")");
}
function pair(code, value) { return code + "\n" + value + "\n"; }

var repo = String(args[args.length - 1]);

// ---- 1. The gate -------------------------------------------------------
var gated = new RLinetypePattern(true, "GATE", "gate probe");
check(gated.setPatternString('A,0.5,-0.2,["CAVE",standard,S=0.1],-0.3'),
    "setPatternString refused a text element (the DWG-plugin gate is back)");

// ---- 2. Read a hand-written complex LTYPE ------------------------------
var dxf = "";
dxf += pair("  0", "SECTION") + pair("  2", "TABLES");
dxf += pair("  0", "TABLE") + pair("  2", "LTYPE") + pair(" 70", "1");
dxf += pair("  0", "LTYPE") + pair("  5", "20") + pair("  2", "CSTEXT");
dxf += pair(" 70", "0") + pair("  3", "Text test") + pair(" 72", "65");
dxf += pair(" 73", "3") + pair(" 40", "1.5");
dxf += pair(" 49", "0.5") + pair(" 74", "0");
dxf += pair(" 49", "-0.5") + pair(" 74", "2") + pair(" 75", "0");
dxf += pair("340", "31") + pair(" 46", "0.1") + pair(" 50", "0.0");
dxf += pair(" 44", "-0.1") + pair(" 45", "-0.05") + pair("  9", "CAVE");
dxf += pair(" 49", "-0.5") + pair(" 74", "0");
dxf += pair("  0", "ENDTAB");
dxf += pair("  0", "TABLE") + pair("  2", "STYLE") + pair(" 70", "1");
dxf += pair("  0", "STYLE") + pair("  5", "31") + pair("  2", "CS_LT_STANDARD");
dxf += pair(" 70", "0") + pair(" 40", "0.0") + pair(" 41", "1.0");
dxf += pair(" 50", "0.0") + pair(" 71", "0") + pair(" 42", "2.5");
dxf += pair("  3", "standard") + pair("  4", "");
dxf += pair("  0", "ENDTAB");
dxf += pair("  0", "ENDSEC");
dxf += pair("  0", "SECTION") + pair("  2", "ENTITIES");
dxf += pair("  0", "LINE") + pair("  8", "0") + pair("  6", "CSTEXT");
dxf += pair(" 10", "0.0") + pair(" 20", "0.0") + pair(" 30", "0.0");
dxf += pair(" 11", "10.0") + pair(" 21", "0.0") + pair(" 31", "0.0");
dxf += pair("  0", "ENDSEC") + pair("  0", "EOF");

var readPath = QDir.tempPath() + "/cs_linetype_read.dxf";
var f = new QFile(readPath);
check(f.open(QIODevice.WriteOnly | QIODevice.Text), "could not write " + readPath);
var ts = new QTextStream(f);
ts.writeString(dxf);
ts.flush();
f.close();

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
di.importFile(readPath);

var lt = doc.queryLinetype("CSTEXT");
check(!isNull(lt), "linetype CSTEXT was not imported");
var p = lt.getPattern();
check(p.getNumDashes() === 3, "CSTEXT has " + p.getNumDashes() + " dashes, expected 3");
check(p.getShapeTextAt(1) === "CAVE", "text at 1 is '" + p.getShapeTextAt(1) + "'");
check(String(p.getShapeTextStyleAt(1)).toLowerCase() === "standard",
    "font at 1 is '" + p.getShapeTextStyleAt(1) + "' -- 340 was not resolved");
near(p.getShapeScaleAt(1), 0.1, "scale at 1");
near(p.getShapeOffsetAt(1).x, -0.1, "offset x at 1");
near(p.getShapeOffsetAt(1).y, -0.05, "offset y at 1");
check(p.hasShapes(), "CSTEXT has no rendered glyphs (updateShapes not run)");

var lines = doc.queryAllEntities(false, true, RS.EntityLine);
check(lines.length === 1, "the LINE after the tables did not import (" +
    lines.length + ") -- the code-9 record boundary is back");
var line = doc.queryEntity(lines[0]);
check(doc.getLinetypeName(line.getLinetypeId()).toUpperCase() === "CSTEXT",
    "line lost its linetype");

// Task 2 appends the write half here.

print("### LINETYPE ROUNDTRIP OK");
QCoreApplication.exit(0);
```

- [ ] **Step 2: Add a run_all stage and run it to see it fail**

Append before the final summary block of `tests/run_all.sh`, and renumber every `N/51` header to `N/52` (`sed -i '' 's#/51 #/52 #' tests/run_all.sh`, then check the two new headers):

```bash
echo
echo "=============================================================="
echo " 52/52 Complex linetypes survive the DXF reader and writer"
echo "=============================================================="
if [ -e "$QCAD" ]; then
    output=$("$QCAD" -no-dock-icon -no-gui -allow-multiple-instances \
                 -autostart tests/linetype_roundtrip_run.js "$PWD" 2>/dev/null)
    echo "$output"
    case "$output" in
        *"### LINETYPE ROUNDTRIP OK"*) ;;
        *) echo "Linetype round trip did not pass."; status=1 ;;
    esac
else
    echo "SKIP: CaveCAD not found at $QCAD"
fi
```

Run the Verify command. Expected: `FAILED: setPatternString refused a text element`.

- [ ] **Step 3: Remove the gate** in `src/core/RLinetypePattern.cpp`, deleting:

```cpp
            if (!RPluginLoader::hasPlugin("DWG")) {
                return false;
            }
```
and put in its place:
```cpp
            // CaveCAD: complex elements are parsed for everyone. The DWG
            // plugin gate made every text/shape linetype unloadable in a
            // build that has no DWG plugin at all.
```

- [ ] **Step 4: dxflib data** in `dl_entities.h`, above `struct DXFLIB_EXPORT DL_LinetypeData`:

```cpp
/**
 * One complex element of a linetype: the text or shape drawn at the end of
 * the dash it follows (group codes 74/75/340/46/50/44/45/9). CaveCAD.
 */
struct DXFLIB_EXPORT DL_LinetypeElement {
    DL_LinetypeElement()
        : flags(0), shapeNumber(0), styleHandle(0), scale(1.0),
          rotation(0.0), offsetX(0.0), offsetY(0.0) {}
    /** 74: 1 = absolute rotation, 2 = text, 4 = shape. 0 = plain dash. */
    int flags;
    /** 75 */
    int shapeNumber;
    /** 340: handle of the STYLE record */
    unsigned long styleHandle;
    /** 46 */
    double scale;
    /** 50, radians */
    double rotation;
    /** 44, 45 */
    double offsetX;
    double offsetY;
    /** 9 */
    std::string text;
};
```

In `DL_LinetypeData` add the member (after `pattern`):
```cpp
    /** Per-dash complex elements, index-aligned with pattern. Empty = plain. CaveCAD. */
    std::vector<DL_LinetypeElement> elements;
```
In `DL_StyleData` add member `unsigned long handle;` after `italic`, and `handle(0)` after `italic(false)` in its initializer list. Ensure `#include <vector>` is at the top of `dl_entities.h`.

- [ ] **Step 5: creation interface** in `dl_creationinterface.h`, after `virtual void addLinetypeDash(double length) = 0;`:

```cpp
    /**
     * Called for each complex-element group code (74, 75, 340, 46, 50,
     * 44, 45, 9) inside an LTYPE record; applies to the dash last passed
     * to addLinetypeDash. CaveCAD.
     */
    virtual void addLinetypeDashElement(int groupCode, const std::string& value) {
        (void)groupCode;
        (void)value;
    }
```

- [ ] **Step 6: dxflib reader** in `dl_dxf.cpp`:

Line 397, replace `else if (groupCode==0 || groupCode==9) {` with:
```cpp
    // CaveCAD: 9 is a header variable name, but inside an LTYPE record it is
    // the embedded text of a complex element and must not end the record.
    else if (groupCode==0 || (groupCode==9 && currentObjectType!=DL_LINETYPE)) {
```

`handleLinetypeData` becomes:
```cpp
bool DL_Dxf::handleLinetypeData(DL_CreationInterface* creationInterface) {
    if (groupCode == 49) {
        creationInterface->addLinetypeDash(toReal(groupValue));
        return true;
    }
    if (groupCode==74 || groupCode==75 || groupCode==340 || groupCode==46 ||
        groupCode==50 || groupCode==44 || groupCode==45 || groupCode==9) {
        creationInterface->addLinetypeDashElement(groupCode, groupValue);
        return true;
    }

    return false;
}
```

In `DL_Dxf::addTextStyle`, after the `DL_StyleData d(...)` constructor call and before `creationInterface->addTextStyle(d);`:
```cpp
    d.handle = strtoul(getStringValue(5, "0").c_str(), NULL, 16);
```
(`<cstdlib>` is already pulled in by dl_dxf.cpp; add `#include <cstdlib>` if the build says otherwise.)

- [ ] **Step 7: importer** — `RDxfImporter.h`: add `#include "RLinetype.h"` if absent; in the public overrides after `addLinetypeDash`:
```cpp
    virtual void addLinetypeDashElement(int groupCode, const std::string& value);
```
and in the private members after `QList<double> pattern;`:
```cpp
    // CaveCAD: complex elements of the linetype being read, by dash index.
    QMap<int, DL_LinetypeElement> patternElements;
    // Text/shape elements whose STYLE (340) arrives later in the file.
    struct PendingLinetypeStyle {
        QSharedPointer<RLinetype> linetype;
        int index;
        unsigned long styleHandle;
        bool shape;
    };
    QList<PendingLinetypeStyle> pendingLinetypeStyles;
    QMap<unsigned long, QString> styleFontsByHandle;
    void resolveLinetypeStyles();
```

`RDxfImporter.cpp` — new functions after `addLinetypeDash`:
```cpp
void RDxfImporter::addLinetypeDashElement(int groupCode, const std::string& value) {
    int idx = pattern.count() - 1;
    if (idx < 0) {
        return;
    }
    DL_LinetypeElement& e = patternElements[idx];
    QString v = QString::fromUtf8(value.c_str()).trimmed();
    switch (groupCode) {
    case 74: e.flags = v.toInt(); break;
    case 75: e.shapeNumber = v.toInt(); break;
    case 340: e.styleHandle = v.toULong(NULL, 16); break;
    case 46: e.scale = v.toDouble(); break;
    case 50: e.rotation = v.toDouble(); break;
    case 44: e.offsetX = v.toDouble(); break;
    case 45: e.offsetY = v.toDouble(); break;
    case 9: e.text = value; break;
    default: break;
    }
}

/**
 * STYLE records come after LTYPE in a DXF, so a text element's font is
 * only known once the whole file is read. The linetype objects were
 * already handed to the import transaction; the storage holds these same
 * pointers, so setting the pattern here is what the document keeps.
 */
void RDxfImporter::resolveLinetypeStyles() {
    for (int i = 0; i < pendingLinetypeStyles.count(); i++) {
        const PendingLinetypeStyle& pl = pendingLinetypeStyles.at(i);
        QString font = styleFontsByHandle.value(pl.styleHandle, "standard");
        RLinetypePattern p = pl.linetype->getPattern();
        p.setShapeTextStyleAt(pl.index, pl.shape ? font + ".shx" : font);
        p.updateShapes();
        pl.linetype->setPattern(p);
    }
    pendingLinetypeStyles.clear();
    styleFontsByHandle.clear();
}
```

In `addLinetype`, replace the lines from `RLinetypePattern p(...)` through `pattern.clear();` with:
```cpp
    RLinetypePattern p(document->isMetric(), name, description, pattern);
    RDxfServices::autoFixLinetypePattern(p);

    // CaveCAD: complex elements (text now, shapes in phase 2).
    QList<int> idxs = patternElements.keys();
    for (int k = 0; k < idxs.count(); k++) {
        int i = idxs.at(k);
        const DL_LinetypeElement& e = patternElements[i];
        if ((e.flags & (2 | 4)) == 0) {
            continue;
        }
        if (e.flags & 2) {
            p.setShapeTextAt(i, decode(e.text.c_str()));
        } else {
            p.setShapeNumberAt(i, e.shapeNumber);
        }
        p.setShapeScaleAt(i, e.scale);
        p.setShapeRotationAt(i, e.rotation);
        p.setShapeOffsetAt(i, RVector(e.offsetX, e.offsetY));
    }

    QSharedPointer<RLinetype> linetype(new RLinetype(document, p));
    importObjectP(linetype);

    for (int k = 0; k < idxs.count(); k++) {
        const DL_LinetypeElement& e = patternElements[idxs.at(k)];
        if ((e.flags & (2 | 4)) != 0) {
            PendingLinetypeStyle pl;
            pl.linetype = linetype;
            pl.index = idxs.at(k);
            pl.styleHandle = e.styleHandle;
            pl.shape = (e.flags & 4) != 0;
            pendingLinetypeStyles.append(pl);
        }
    }

    patternElements.clear();
    pattern.clear();
```
(Delete the commented-out `RLinetypePatternMap` lines that sat between; keep nothing else.)

In `addTextStyle`, after `s.bold = ...;` add:
```cpp
    if (data.handle != 0) {
        styleFontsByHandle.insert(data.handle, s.font);
    }
```

In `importFile`, directly after the `if (success==false) { ... }` block:
```cpp
    resolveLinetypeStyles();
```

- [ ] **Step 8: Build, deploy, re-sign, run**

```bash
cd ~/Documents/github/cavecad-src && ninja -j20 2>&1 | tail -3
cp debug/libcavecadcore.dylib /Applications/CaveCAD.app/Contents/Frameworks/
cp plugins/libcavecaddxf.dylib /Applications/CaveCAD.app/Contents/PlugIns/
codesign --force --deep --sign - /Applications/CaveCAD.app && codesign --verify --deep /Applications/CaveCAD.app
```
Then the Verify command. Expected `### LINETYPE ROUNDTRIP OK`. If empty output: check codesign first.

- [ ] **Step 9: Commit both repos**

```bash
cd ~/Documents/github/cavecad-src && git add -A src && git commit -m "feat(dxf): read complex linetypes -- text elements, fonts, code-9 scoped to LTYPE"
cd ~/Documents/github/cavecad-tools && git add tests/linetype_roundtrip_run.js tests/run_all.sh && git commit -m "test: complex linetype DXF read stage"
```

---

### Task 2: Engine writes complex linetypes

**Goal:** A text linetype saved to DXF 2000 reopens identical (dashes, text, font, scale, rotation, offset), with a `CS_LT_<FONT>` STYLE record the 340 handle points at.

**Files:**
- Modify: `cavecad-tools/tests/linetype_roundtrip_run.js` (write half)
- Modify: `cavecad-src/src/3rdparty/dxflib/src/dl_writer.h` (reserveHandle)
- Modify: `cavecad-src/src/3rdparty/dxflib/src/dl_dxf.cpp` (writeLinetype, writeStyle)
- Modify: `cavecad-src/src/io/dxf/RDxfExporter.h`, `RDxfExporter.cpp`
- Modify: `cavecad-src/VERSION` (0.9.4.0 → 0.9.5.0)

**Acceptance Criteria:**
- [ ] Round trip of `A,0.5,-0.2,["CAVE",standard,S=0.1,R=15,X=-0.1,Y=-0.05],-0.3`: dash lengths, text, font, scale 0.1, rotation 15°, offset equal to 1e-6
- [ ] Written file contains a `CS_LT_STANDARD` STYLE whose handle equals the LTYPE's 340
- [ ] A 300-character text element round-trips (no line-length loss)
- [ ] A line using the linetype keeps it after reopen

**Verify:** same command as Task 1 → `### LINETYPE ROUNDTRIP OK`

**Steps:**

- [ ] **Step 1: Write the failing write half** — insert in place of `// Task 2 appends the write half here.`:

```js
// ---- 3. Write, reopen, compare -----------------------------------------
function dxf2000Filter() {
    var filters = RFileExporterRegistry.getFilterStrings();
    for (var i = 0; i < filters.length; i++) {
        var s = String(filters[i]);
        if (s.indexOf("dxflib") >= 0 && s.indexOf("2000") >= 0) {
            return s;
        }
    }
    fail("no DXF 2000 dxflib export filter");
}

function roundTrip(name, patternString) {
    var d = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var i = new RDocumentInterface(d);
    var pat = new RLinetypePattern(true, name, name + " test");
    check(pat.setPatternString(patternString), name + ": pattern refused");
    i.applyOperation(new RAddObjectOperation(new RLinetype(d, pat), false));
    var ln = new RLineEntity(d, new RLineData(new RVector(0, 0), new RVector(10, 0)));
    ln.setLinetypeId(d.getLinetypeId(name));
    i.applyOperation(new RAddObjectOperation(ln, false));

    var path = QDir.tempPath() + "/cs_linetype_" + name + ".dxf";
    check(i.exportFile(path, dxf2000Filter(), false), name + ": export failed");

    var back = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
    var bi = new RDocumentInterface(back);
    bi.importFile(path);
    var blt = back.queryLinetype(name);
    check(!isNull(blt), name + ": linetype missing after reopen");
    var a = pat, b = blt.getPattern();
    check(b.getNumDashes() === a.getNumDashes(), name + ": dash count " +
        b.getNumDashes() + " vs " + a.getNumDashes());
    for (var k = 0; k < a.getNumDashes(); k++) {
        near(b.getDashLengthAt(k), a.getDashLengthAt(k), name + ": dash " + k);
        check(b.getShapeTextAt(k) === a.getShapeTextAt(k),
            name + ": text at " + k + " '" + b.getShapeTextAt(k) + "'");
        if (a.getShapeTextAt(k) !== "") {
            check(String(b.getShapeTextStyleAt(k)).toLowerCase() ===
                String(a.getShapeTextStyleAt(k)).toLowerCase(),
                name + ": font at " + k + " '" + b.getShapeTextStyleAt(k) + "'");
            near(b.getShapeScaleAt(k), a.getShapeScaleAt(k), name + ": scale " + k);
            near(b.getShapeRotationAt(k), a.getShapeRotationAt(k), name + ": rotation " + k);
            near(b.getShapeOffsetAt(k).x, a.getShapeOffsetAt(k).x, name + ": x " + k);
            near(b.getShapeOffsetAt(k).y, a.getShapeOffsetAt(k).y, name + ": y " + k);
        }
    }
    var bl = back.queryAllEntities(false, true, RS.EntityLine);
    check(bl.length === 1, name + ": line missing after reopen");
    check(back.getLinetypeName(back.queryEntity(bl[0]).getLinetypeId())
        .toUpperCase() === name.toUpperCase(), name + ": line lost its linetype");
    return path;
}

var written = roundTrip("CSRT",
    'A,0.5,-0.2,["CAVE",standard,S=0.1,R=15,X=-0.1,Y=-0.05],-0.3');

// The 340 must point at the CS_LT_ STYLE record's own handle.
var rf = new QFile(written);
check(rf.open(QIODevice.ReadOnly | QIODevice.Text), "cannot reread " + written);
var body = String(new QTextStream(rf).readAll());
rf.close();
var ptr = /\n\s*340\n([0-9A-Fa-f]+)\n/.exec(body);
check(ptr !== null, "no 340 pointer written");
var styleRe = new RegExp("\\n\\s*0\\nSTYLE\\n\\s*5\\n" + ptr[1] +
    "\\n[\\s\\S]*?\\n\\s*2\\nCS_LT_STANDARD\\n");
check(styleRe.test(body), "340 " + ptr[1] + " does not name the CS_LT_STANDARD STYLE");

var longText = "";
while (longText.length < 300) {
    longText += "X";
}
roundTrip("CSLONG", 'A,1,[' + '"' + longText + '"' + ',standard,S=0.1],-1');
```

Run. Expected FAIL: `CSRT: text at 1 ''` (writer drops elements).

- [ ] **Step 2: writer handle reservation** — `dl_writer.h`, after `handle()`:

```cpp
    /**
     * Takes the next handle without writing it, for records that other
     * records point at before they are written. CaveCAD.
     */
    unsigned long reserveHandle() const {
        return m_handle++;
    }
```

- [ ] **Step 3: dxflib writeLinetype / writeStyle** — in `writeLinetype`'s final `else` branch replace the dash loop with:

```cpp
        for (int i = 0; i < data.numberOfDashes; i++) {
            dw.dxfReal(49, data.pattern[i]);
            if (version>=DL_VERSION_R13) {
                if (i < (int)data.elements.size() && data.elements[i].flags != 0) {
                    const DL_LinetypeElement& e = data.elements[i];
                    dw.dxfInt(74, e.flags);
                    dw.dxfInt(75, e.shapeNumber);
                    if (e.styleHandle != 0) {
                        dw.dxfHex(340, e.styleHandle);
                    }
                    dw.dxfReal(46, e.scale);
                    dw.dxfReal(50, e.rotation);
                    dw.dxfReal(44, e.offsetX);
                    dw.dxfReal(45, e.offsetY);
                    if (e.flags & 2) {
                        dw.dxfString(9, e.text);
                    }
                } else {
                    dw.dxfInt(74, 0);
                }
            }
        }
```

In `writeStyle`, replace the R2000 handle block with:
```cpp
    if (version==DL_VERSION_2000) {
        if (style.name=="Standard") {
            styleHandleStd = dw.handle();
        }
        else if (style.handle != 0) {
            // reserved earlier: a linetype's 340 already points here
            dw.dxfHex(5, style.handle);
        }
        else {
            dw.handle();
        }
    }
```

- [ ] **Step 4: exporter** — `RDxfExporter.h` private members:
```cpp
    // CaveCAD: font (lower case) -> reserved STYLE handle for linetype text.
    QMap<QString, unsigned long> linetypeStyleHandles;
```

`RDxfExporter.cpp` — at the start of the LTYPE block (just before `dw->tableLinetypes(...)` in the non-minimalistic branch at ~line 153), insert:
```cpp
        // CaveCAD: every font a text linetype names gets a STYLE record,
        // written later with the STYLE table. Its handle is taken now
        // because the LTYPE's 340 has to point at it.
        linetypeStyleHandles.clear();
        if (exportVersion >= DL_Codes::AC1015) {
            QStringList ltNames = RS::toList(document->getLinetypeNames());
            for (int n = 0; n < ltNames.size(); n++) {
                QSharedPointer<RLinetype> ltp = document->queryLinetype(ltNames[n]);
                if (ltp.isNull()) {
                    continue;
                }
                RLinetypePattern pat = ltp->getPattern();
                for (int i = 0; i < pat.getNumDashes(); i++) {
                    QString st = pat.getShapeTextStyleAt(i).toLower();
                    if (!pat.hasShapeTextAt(i) || st.isEmpty() ||
                        st.endsWith(".shx") || st.endsWith(".shp")) {
                        continue;
                    }
                    if (!linetypeStyleHandles.contains(st)) {
                        linetypeStyleHandles.insert(st, dw->reserveHandle());
                    }
                }
            }
        }
```
(`exportVersion` is a local of `exportFile`; this block is in the same function. If the LTYPE block is not in `exportFile`, pass the version via a member `bool writeComplexLinetypes` set in exportFile.)

Replace `writeLinetype` with:
```cpp
void RDxfExporter::writeLinetype(const RLinetypePattern& lt) {
    int numDashes = lt.getNumDashes();
    double* dashes = new double[numDashes];
    std::vector<DL_LinetypeElement> elements(numDashes);
    for (int i=0; i<numDashes; i++) {
        dashes[i] = lt.getDashLengthAt(i);

        // CaveCAD: text elements. Shape elements are phase 2 and are
        // written as plain dashes until then.
        QString text = lt.getShapeTextAt(i);
        QString style = lt.getShapeTextStyleAt(i).toLower();
        if (!lt.hasShapeTextAt(i) || text.isEmpty() ||
            style.endsWith(".shx") || style.endsWith(".shp")) {
            continue;
        }
        DL_LinetypeElement& e = elements[i];
        e.flags = 2;
        e.text = (const char*)RDxfExporter::escapeUnicode(text);
        e.styleHandle = linetypeStyleHandles.value(style, 0);
        e.scale = lt.hasShapeScaleAt(i) ? lt.getShapeScaleAt(i) : 1.0;
        e.rotation = lt.getShapeRotationAt(i);
        e.offsetX = lt.getShapeOffsetAt(i).x;
        e.offsetY = lt.getShapeOffsetAt(i).y;
    }

    DL_LinetypeData data(
        (const char*)RDxfExporter::escapeUnicode(lt.getName()),
        (const char*)RDxfExporter::escapeUnicode(lt.getDescription()),
        0,
        numDashes,
        lt.getPatternLength(),
        dashes
    );
    data.elements = elements;
    dxf.writeLinetype(*dw, data);

    delete[] dashes;
}
```

In the STYLE block, just before `dw->tableStyle(uniqueTextStyles.size());`:
```cpp
        // CaveCAD: the STYLE records text linetypes point at (see LTYPE).
        QMapIterator<QString, unsigned long> lts(linetypeStyleHandles);
        while (lts.hasNext()) {
            lts.next();
            DL_StyleData ls((const char*)("CS_LT_" + lts.key().toUpper()).toUtf8(),
                            0, 0.0, 1.0, 0.0, 0, 2.5,
                            (const char*)lts.key().toUtf8(), "");
            ls.handle = lts.value();
            uniqueTextStyles.append(ls);
        }
```

- [ ] **Step 5: bump VERSION, build, deploy, re-sign, run** — `echo 0.9.5.0 > VERSION`; commands as Task 1 Step 8. Expected `### LINETYPE ROUNDTRIP OK`.

- [ ] **Step 6: Commit both repos**

```bash
cd ~/Documents/github/cavecad-src && git add -A src VERSION && git commit -m "feat(dxf): write complex text linetypes with their STYLE records (0.9.5.0)"
cd ~/Documents/github/cavecad-tools && git add tests/linetype_roundtrip_run.js && git commit -m "test: complex linetype write round trip"
```

---

### Task 3: `CsLinetype` — the pattern model (pure)

**Goal:** A pure library that converts between a linetype model and `.lin` text, validates it, and lays it out along a straight line for preview.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsLinetype.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js` (include)
- Modify: `tests/js_unit.js` (CORE_FILES + tests)

**Acceptance Criteria:**
- [ ] `toPattern` of dash/gap/text model = `A,0.5,-0.2,["CAVE",standard,S=0.1,R=15,X=-0.1,Y=-0.05],-0.3`
- [ ] `fromPattern(toPattern(m))` reproduces every field
- [ ] `parseLin` reads two linetypes with comments, reports a headerless pattern as an error
- [ ] `validate` flags: empty name, spaces in name, no segments, gaps only, text with a space, text with no font, scale ≤ 0
- [ ] `layout` puts a glyph at the end of the segment it follows
- [ ] js_unit green under node and under CaveCAD

**Verify:** `node tests/js_unit.js` → `### UNIT OK <n> assertions`

**Steps:**

- [ ] **Step 1: Write failing tests** — add `"scripts/CaveSurvey/Core/CsLinetype.js",` to `CORE_FILES` (after `CsUnits.js`), and before the `// Report.` block:

```js
// ---------------------------------------------------------------------
// CsLinetype -- linetype patterns (Linetype Maker)
// ---------------------------------------------------------------------
(function() {
    var m = { name: "CSTEXT", description: "Text test", segments: [
        CsLinetype.segment(0.5),
        CsLinetype.segment(-0.2),
        CsLinetype.segment(-0.3)
    ] };
    m.segments[1].text = "CAVE";
    m.segments[1].style = "standard";
    m.segments[1].scale = 0.1;
    m.segments[1].rotation = 15;
    m.segments[1].x = -0.1;
    m.segments[1].y = -0.05;
    eqs(CsLinetype.toPattern(m),
        'A,0.5,-0.2,["CAVE",standard,S=0.1,R=15,X=-0.1,Y=-0.05],-0.3',
        "toPattern writes the text element after its segment");

    var back = CsLinetype.fromPattern(CsLinetype.toPattern(m));
    eqs(back.errors.length, 0, "fromPattern: no errors");
    eqs(back.segments.length, 3, "fromPattern: three segments");
    eqs(back.segments[1].text, "CAVE", "fromPattern: text");
    eqs(back.segments[1].style, "standard", "fromPattern: font");
    eqs(back.segments[1].shape, false, "fromPattern: quoted = text, not shape");
    near(back.segments[1].scale, 0.1, 1e-12, "fromPattern: scale");
    near(back.segments[1].rotation, 15, 1e-12, "fromPattern: rotation");
    near(back.segments[1].x, -0.1, 1e-12, "fromPattern: x");
    near(back.segments[1].y, -0.05, 1e-12, "fromPattern: y");
    eqs(back.segments[2].text, "", "fromPattern: plain gap stays plain");

    eqs(CsLinetype.toPattern({ name: "D", description: "", segments: [
        CsLinetype.segment(0.25), CsLinetype.segment(-0.125)] }),
        "A,0.25,-0.125", "toPattern: plain dashes have no brackets");
    eqs(CsLinetype.fromPattern('A,1,["X",standard],-1').segments[0].text, "X",
        "fromPattern: element attaches to the segment before it");
    ok(CsLinetype.fromPattern('A,["X",standard],1').errors.length === 1,
        "fromPattern: an element with nothing before it is an error");
    eqs(CsLinetype.fromPattern('A,1,[TICK,cave.shx,S=2],-1').segments[0].shape,
        true, "fromPattern: unquoted name = shape");

    var lin = ";; comment\n*CSTEXT,Text test\nA,0.5,-0.2,[\"CAVE\",standard,S=0.1],-0.3\n" +
        "\n*DASH2,Two dashes\nA,1,-0.5\n" +
        "A,2,-2\n";
    var parsed = CsLinetype.parseLin(lin);
    eqs(parsed.linetypes.length, 2, "parseLin: two linetypes");
    eqs(parsed.linetypes[0].name, "CSTEXT", "parseLin: first name");
    eqs(parsed.linetypes[0].description, "Text test", "parseLin: description");
    eqs(parsed.linetypes[1].segments.length, 2, "parseLin: second pattern");
    eqs(parsed.errors.length, 1, "parseLin: headerless pattern reported");

    var again = CsLinetype.parseLin(CsLinetype.writeLin(parsed.linetypes));
    eqs(again.linetypes.length, 2, "writeLin then parseLin keeps both");
    eqs(CsLinetype.toPattern(again.linetypes[0]),
        CsLinetype.toPattern(parsed.linetypes[0]), "writeLin round trip");

    eqs(CsLinetype.validate(m).length, 0, "validate: a good linetype passes");
    function problems(edit) {
        var c = JSON.parse(JSON.stringify(m));
        edit(c);
        return CsLinetype.validate(c).length;
    }
    ok(problems(function(c) { c.name = ""; }) > 0, "validate: empty name");
    ok(problems(function(c) { c.name = "CAVE WALL"; }) > 0, "validate: space in name");
    ok(problems(function(c) { c.segments = []; }) > 0, "validate: no segments");
    ok(problems(function(c) { c.segments = [CsLinetype.segment(-1)]; }) > 0,
        "validate: gaps only");
    ok(problems(function(c) { c.segments[1].text = "TWO WORDS"; }) > 0,
        "validate: space in text");
    ok(problems(function(c) { c.segments[1].style = ""; }) > 0, "validate: no font");
    ok(problems(function(c) { c.segments[1].scale = 0; }) > 0, "validate: zero scale");

    var lay = CsLinetype.layout(m, 2.0);
    eqs(lay.dashes.length, 2, "layout: two dashes in 2 units of a 1-unit period");
    near(lay.dashes[0][0], 0, 1e-12, "layout: first dash starts at 0");
    near(lay.dashes[0][1], 0.5, 1e-12, "layout: first dash ends at 0.5");
    eqs(lay.glyphs.length, 2, "layout: one glyph per period");
    near(lay.glyphs[0].at, 0.7, 1e-12, "layout: glyph at the END of its gap");
    eqs(lay.glyphs[0].index, 1, "layout: glyph names its segment");
}());
```

Run `node tests/js_unit.js`. Expected: fail (`CsLinetype is not defined`).

- [ ] **Step 2: Implement** `scripts/CaveSurvey/Core/CsLinetype.js`:

```js
// CsLinetype.js -- a linetype as data: the pure half of Linetype Maker.
//
// A linetype is a repeating list of SEGMENTS. A positive length draws a
// dash, a negative one leaves a gap, zero is a dot. Any segment may carry
// a TEXT (or, from phase 2, a SHAPE) that the engine draws at the END of
// that segment -- the same place RExporter puts it, which is why a text
// is modelled as a property of the segment it follows and not as a
// segment of its own: the engine indexes it that way, the .lin syntax
// writes it that way, and a model shaped differently would need a
// translation in both directions that could drift.
//
// No engine calls here: this file runs under node too (tests/js_unit.js).

var CsLinetype = {};

/** Serialised lines past this risk dxflib's 1023-character line limit. */
CsLinetype.MAX_LINE = 1000;

/** DXF symbol-table names: no spaces, nothing a .lin header would split. */
CsLinetype.NAME_RE = /^[A-Za-z0-9_\-$]+$/;

/** The engine reads embedded text as [^, ]* -- no spaces, no commas. */
CsLinetype.TEXT_RE = /^[^\s,"\[\]]+$/;

CsLinetype.segment = function(length) {
    return { length: Number(length), text: "", style: "", shape: false,
             scale: 1, rotation: 0, x: 0, y: 0 };
};

CsLinetype.kindOf = function(seg) {
    if (seg.text !== "") {
        return seg.shape ? "shape" : "text";
    }
    if (seg.length > 0) {
        return "dash";
    }
    if (seg.length < 0) {
        return "gap";
    }
    return "dot";
};

/** A number as .lin writes it: no float noise, no "-0". */
CsLinetype.num = function(v) {
    var r = Math.round(Number(v) * 1e6) / 1e6;
    if (r === 0) {
        r = 0;
    }
    return String(r);
};

CsLinetype.toPattern = function(model) {
    var parts = ["A"];
    for (var i = 0; i < model.segments.length; i++) {
        var seg = model.segments[i];
        parts.push(CsLinetype.num(seg.length));
        if (seg.text === "") {
            continue;
        }
        var g = (seg.shape ? seg.text : '"' + seg.text + '"') + "," + seg.style;
        g += ",S=" + CsLinetype.num(seg.scale);
        if (Number(seg.rotation) !== 0) {
            g += ",R=" + CsLinetype.num(seg.rotation);
        }
        if (Number(seg.x) !== 0) {
            g += ",X=" + CsLinetype.num(seg.x);
        }
        if (Number(seg.y) !== 0) {
            g += ",Y=" + CsLinetype.num(seg.y);
        }
        parts.push("[" + g + "]");
    }
    return parts.join(",");
};

/** Splits on commas outside brackets and quotes. */
CsLinetype.splitTop = function(text) {
    var out = [], cur = "", depth = 0, quoted = false;
    for (var i = 0; i < text.length; i++) {
        var c = text.charAt(i);
        if (c === '"') {
            quoted = !quoted;
        } else if (!quoted && c === "[") {
            depth++;
        } else if (!quoted && c === "]") {
            depth--;
        }
        if (c === "," && depth === 0 && !quoted) {
            out.push(cur);
            cur = "";
        } else {
            cur += c;
        }
    }
    out.push(cur);
    return out;
};

/** \return { segments, errors } */
CsLinetype.fromPattern = function(text) {
    var segments = [], errors = [];
    var parts = CsLinetype.splitTop(String(text).trim());
    if (parts.length > 0 && /^[AS]$/i.test(parts[0].trim())) {
        parts.shift();
    }
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i].trim();
        if (part === "") {
            continue;
        }
        if (part.charAt(0) !== "[") {
            var len = Number(part);
            if (!isFinite(len)) {
                errors.push("'" + part + "' is not a length");
                continue;
            }
            segments.push(CsLinetype.segment(len));
            continue;
        }
        if (segments.length === 0) {
            errors.push("'" + part + "' has no dash or gap before it");
            continue;
        }
        var inner = CsLinetype.splitTop(part.replace(/^\[/, "").replace(/\]$/, ""));
        var seg = segments[segments.length - 1];
        var name = (inner[0] || "").trim();
        seg.shape = !(name.charAt(0) === '"');
        seg.text = name.replace(/^"/, "").replace(/"$/, "");
        seg.style = (inner[1] || "").trim();
        for (var k = 2; k < inner.length; k++) {
            var kv = /^\s*([SRAXY])[^=]*=\s*(.+?)\s*$/i.exec(inner[k]);
            if (kv === null) {
                continue;
            }
            var v = Number(kv[2]);
            switch (kv[1].toUpperCase()) {
            case "S": seg.scale = v; break;
            case "R": case "A": seg.rotation = v; break;
            case "X": seg.x = v; break;
            case "Y": seg.y = v; break;
            }
        }
    }
    return { segments: segments, errors: errors };
};

/** \return { linetypes: [model], errors: [string] } */
CsLinetype.parseLin = function(text) {
    var lines = String(text).split(/\r?\n/);
    var linetypes = [], errors = [], cur = null;
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (line === "" || line.indexOf(";;") === 0) {
            continue;
        }
        if (line.charAt(0) === "*") {
            var header = line.substring(1);
            var comma = header.indexOf(",");
            cur = { name: (comma < 0 ? header : header.substring(0, comma)).trim(),
                    description: comma < 0 ? "" : header.substring(comma + 1).trim(),
                    segments: null };
            continue;
        }
        if (cur === null || cur.segments !== null) {
            errors.push("line " + (i + 1) + ": a pattern with no *NAME line above it");
            continue;
        }
        var r = CsLinetype.fromPattern(line);
        if (r.errors.length > 0) {
            errors.push(cur.name + ": " + r.errors.join("; "));
            cur = null;
            continue;
        }
        cur.segments = r.segments;
        linetypes.push(cur);
    }
    return { linetypes: linetypes, errors: errors };
};

CsLinetype.writeLin = function(models) {
    var out = "";
    for (var i = 0; i < models.length; i++) {
        out += "*" + models[i].name + "," + (models[i].description || "") + "\n";
        out += CsLinetype.toPattern(models[i]) + "\n";
    }
    return out;
};

/** \return plain-language problems; empty means it can be saved. */
CsLinetype.validate = function(model) {
    var out = [];
    var name = String(model.name || "");
    if (name === "") {
        out.push("Give the linetype a name.");
    } else if (!CsLinetype.NAME_RE.test(name)) {
        out.push("A name may use letters, digits, _ - and $ only -- no spaces.");
    }
    var segs = model.segments || [];
    if (segs.length === 0) {
        out.push("Add at least one dash or gap.");
        return out;
    }
    var draws = false, period = 0;
    for (var i = 0; i < segs.length; i++) {
        var s = segs[i], row = "Row " + (i + 1) + ": ";
        if (!isFinite(Number(s.length))) {
            out.push(row + "the length is not a number.");
            continue;
        }
        period += Math.abs(s.length);
        if (s.length >= 0 || s.text !== "") {
            draws = true;
        }
        if (s.text !== "") {
            if (!CsLinetype.TEXT_RE.test(s.text)) {
                out.push(row + "text cannot contain spaces, commas, quotes or brackets.");
            }
            if (String(s.style || "") === "") {
                out.push(row + "text needs a font.");
            }
            if (!(Number(s.scale) > 0)) {
                out.push(row + "the text size must be above zero.");
            }
        }
    }
    if (!draws) {
        out.push("A pattern of only gaps draws nothing.");
    }
    if (period === 0) {
        out.push("The pattern has no length.");
    }
    if (CsLinetype.toPattern(model).length > CsLinetype.MAX_LINE ||
            ("*" + name + "," + (model.description || "")).length > CsLinetype.MAX_LINE) {
        out.push("Too long to save safely -- shorten the texts or the description.");
    }
    return out;
};

/**
 * The pattern walked along a straight line of `length`, the way the engine
 * walks it: dashes as [from, to], dots as positions, and each text at the
 * END of the segment it belongs to.
 */
CsLinetype.layout = function(model, length) {
    var out = { dashes: [], dots: [], glyphs: [] };
    var segs = model.segments || [];
    var period = 0;
    for (var p = 0; p < segs.length; p++) {
        period += Math.abs(Number(segs[p].length) || 0);
    }
    if (segs.length === 0 || period <= 0) {
        return out;
    }
    var cursor = 0, i = 0, guard = 0;
    while (cursor < length && guard < 10000) {
        var seg = segs[i];
        var len = Math.abs(Number(seg.length) || 0);
        if (seg.length > 0) {
            out.dashes.push([cursor, Math.min(cursor + len, length)]);
        } else if (seg.length === 0) {
            out.dots.push(cursor);
        }
        cursor += len;
        if (seg.text !== "" && cursor <= length) {
            out.glyphs.push({ at: cursor, index: i });
        }
        i = (i + 1) % segs.length;
        guard++;
    }
    return out;
};
```

Add `include(includeBasePath + "/CsLinetype.js");` to `Core/CsAll.js` right after the `CsUnits.js` line.

- [ ] **Step 3: Run tests** — `node tests/js_unit.js` → `### UNIT OK`; then the CaveCAD js_unit command from run_all → `### UNIT OK`; `python3 -m unittest discover -s tests` → OK.

- [ ] **Step 4: Commit** — `git add scripts/CaveSurvey/Core/CsLinetype.js scripts/CaveSurvey/Core/CsAll.js tests/js_unit.js && git commit -m "feat: CsLinetype -- linetype pattern model, .lin read/write, validation, layout"`

---

### Task 4: `CsLinetypeStore` — personal library and drawing

**Goal:** Read/write the personal `.lin` library, list a drawing's linetypes as models, and add or replace a linetype in a drawing.

**Files:**
- Create: `scripts/CaveSurvey/Core/CsLinetypeStore.js`
- Create: `tests/linetype_maker_run.js`
- Modify: `scripts/CaveSurvey/Core/CsAll.js`, `tests/js_unit.js` (`CORE_FILES_NOT_LOADED` entry), `tests/run_all.sh` (stage 53)

**Acceptance Criteria:**
- [ ] `saveCustom` twice with different names → library file holds both; same name again replaces, not duplicates
- [ ] `removeCustom` drops one
- [ ] `applyToDocument` adds a new linetype; applying an edited model with the same name replaces its pattern
- [ ] `fromDocument` lists it back with the same pattern string, and skips BYLAYER/BYBLOCK/CONTINUOUS
- [ ] Stage prints `### LINETYPE MAKER OK`

**Verify:** `$QCAD -no-dock-icon -no-gui -allow-multiple-instances -autostart tests/linetype_maker_run.js "$PWD"` → `### LINETYPE MAKER OK`

**Steps:**

- [ ] **Step 1: Failing test** `tests/linetype_maker_run.js`:

```js
/**
 * CsLinetypeStore against the real engine: the personal library file,
 * and adding / replacing a linetype in a drawing.
 */
function fail(msg) {
    print("### LINETYPE MAKER FAILED: " + msg);
    QCoreApplication.exit(1);
    throw msg;
}
function check(cond, msg) {
    if (!cond) {
        fail(msg);
    }
}

var repo = String(args[args.length - 1]);
var includeBasePath = repo + "/scripts/CaveSurvey/Core";
function loadRepo(path) {
    var f = new QFile(repo + "/" + path);
    check(f.open(QIODevice.ReadOnly | QIODevice.Text), "cannot read " + path);
    var src = String(new QTextStream(f).readAll());
    f.close();
    (0, eval)(src.replace(/^\s*include\(.*\);\s*$/mg, ""));
}
loadRepo("scripts/CaveSurvey/Core/CsTell.js");
loadRepo("scripts/CaveSurvey/Core/CsLinetype.js");
loadRepo("scripts/CaveSurvey/Core/CsLinetypeStore.js");

var libPath = QDir.tempPath() + "/cs_lt_test/CaveCustomLinetypes.lin";
new QFile(libPath).remove();
CsLinetypeStore.pathOverride = libPath;

function model(name, pattern) {
    var r = CsLinetype.fromPattern(pattern);
    check(r.errors.length === 0, name + ": bad test pattern");
    return { name: name, description: name + " test", segments: r.segments };
}

check(CsLinetypeStore.loadCustom().linetypes.length === 0, "fresh library not empty");
check(CsLinetypeStore.saveCustom(model("CSA", "A,1,-0.5")) === null, "save CSA");
check(CsLinetypeStore.saveCustom(model("CSB",
    'A,0.5,-0.2,["CAVE",standard,S=0.1],-0.3')) === null, "save CSB");
check(CsLinetypeStore.loadCustom().linetypes.length === 2, "library should hold 2");
check(CsLinetypeStore.saveCustom(model("csa", "A,2,-1")) === null, "replace CSA");
var lib = CsLinetypeStore.loadCustom().linetypes;
check(lib.length === 2, "replace by name (any case) duplicated: " + lib.length);
check(CsLinetype.toPattern(lib[0]) === "A,2,-1", "CSA not replaced: " +
    CsLinetype.toPattern(lib[0]));
check(CsLinetypeStore.removeCustom("CSB") === null, "remove CSB");
check(CsLinetypeStore.loadCustom().linetypes.length === 1, "remove failed");

var doc = new RDocument(new RMemoryStorage(), new RSpatialIndexNavel());
var di = new RDocumentInterface(doc);
var m = model("CSTEXT", 'A,0.5,-0.2,["CAVE",standard,S=0.1],-0.3');
check(CsLinetypeStore.applyToDocument(doc, di, m) === null, "apply new");
var listed = CsLinetypeStore.fromDocument(doc);
var found = null;
for (var i = 0; i < listed.length; i++) {
    check(["BYLAYER", "BYBLOCK", "CONTINUOUS"].indexOf(listed[i].name.toUpperCase()) < 0,
        "fromDocument listed " + listed[i].name);
    if (listed[i].name.toUpperCase() === "CSTEXT") {
        found = listed[i];
    }
}
check(found !== null, "applied linetype not listed");
check(found.segments[1].text === "CAVE", "listed linetype lost its text");

m.segments[0].length = 0.75;
check(CsLinetypeStore.applyToDocument(doc, di, m) === null, "apply replace");
var p = doc.queryLinetype("CSTEXT").getPattern();
check(Math.abs(p.getDashLengthAt(0) - 0.75) < 1e-9, "replace did not take: " +
    p.getDashLengthAt(0));
var count = 0;
var names = doc.getLinetypeNames();
for (var n = 0; n < names.length; n++) {
    if (String(names[n]).toUpperCase() === "CSTEXT") {
        count++;
    }
}
check(count === 1, "replace made a second CSTEXT");

print("### LINETYPE MAKER OK");
QCoreApplication.exit(0);
```

Stage 53 in `run_all.sh` (same shape as Task 1's, marker `### LINETYPE MAKER OK`, title "Linetype Maker's library and drawing store"); renumber `/52` → `/53`. Run → fails (`CsLinetypeStore` file missing).

- [ ] **Step 2: Implement** `scripts/CaveSurvey/Core/CsLinetypeStore.js`:

```js
// CsLinetypeStore.js -- where Linetype Maker's linetypes live.
//
// A caver's own linetypes live in ONE .lin file beside their caves,
// ~/Documents/Cave/linetypes/CaveCustomLinetypes.lin: that folder syncs
// and is backed up, and no release touches it. NOT the template -- the
// Symbol Palette kept customs in the template until publish.sh replaced
// it and took a real symbol with it (2026-09-06).
//
// A drawing's linetypes are RLinetype objects in its document; this file
// is the only code that writes them, so the one trap below is handled once.

var CsLinetypeStore = {};

CsLinetypeStore.CUSTOM_NAME = "CaveCustomLinetypes.lin";

/** Tests point the library at a scratch file. */
CsLinetypeStore.pathOverride = null;

CsLinetypeStore.BUILT_IN = ["BYLAYER", "BYBLOCK", "CONTINUOUS"];

CsLinetypeStore.customPath = function() {
    if (CsLinetypeStore.pathOverride !== null) {
        return CsLinetypeStore.pathOverride;
    }
    try {
        var setting = RSettings.getStringValue("CaveSurvey/LinetypeLibrary", "");
        if (setting !== "") {
            return setting;
        }
    } catch (eSet) {
    }
    return QDir.homePath() + "/Documents/Cave/linetypes/" + CsLinetypeStore.CUSTOM_NAME;
};

CsLinetypeStore.readText = function(path) {
    var f = new QFile(path);
    if (!f.exists() || !f.open(QIODevice.ReadOnly | QIODevice.Text)) {
        return null;
    }
    var stream = new QTextStream(f);
    try {
        stream.setEncoding(QStringConverter.Utf8);
    } catch (eEnc) {
    }
    var text = String(stream.readAll());
    f.close();
    return text;
};

/** \return null on success, else a sentence saying what failed. */
CsLinetypeStore.writeText = function(path, text) {
    try {
        new QDir().mkpath(new QFileInfo(path).absolutePath());
        var f = new QFile(path);
        if (!f.open(QIODevice.WriteOnly | QIODevice.Truncate | QIODevice.Text)) {
            return "Could not write " + path + ".";
        }
        var stream = new QTextStream(f);
        try {
            stream.setEncoding(QStringConverter.Utf8);
        } catch (eEnc) {
        }
        stream.writeString(text);
        stream.flush();
        f.close();
        return null;
    } catch (e) {
        return "Could not write " + path + " (" + e + ").";
    }
};

/** \return { linetypes, errors } -- empty when the file does not exist yet. */
CsLinetypeStore.loadCustom = function() {
    var text = CsLinetypeStore.readText(CsLinetypeStore.customPath());
    if (text === null) {
        return { linetypes: [], errors: [] };
    }
    return CsLinetype.parseLin(text);
};

CsLinetypeStore.indexOf = function(list, name) {
    var want = String(name).toUpperCase();
    for (var i = 0; i < list.length; i++) {
        if (String(list[i].name).toUpperCase() === want) {
            return i;
        }
    }
    return -1;
};

/** Adds or replaces (by name, any case). \return null or an error. */
CsLinetypeStore.saveCustom = function(model) {
    var problems = CsLinetype.validate(model);
    if (problems.length > 0) {
        return problems.join(" ");
    }
    var list = CsLinetypeStore.loadCustom().linetypes;
    var at = CsLinetypeStore.indexOf(list, model.name);
    if (at >= 0) {
        list[at] = model;
    } else {
        list.push(model);
    }
    return CsLinetypeStore.writeText(CsLinetypeStore.customPath(),
        CsLinetype.writeLin(list));
};

CsLinetypeStore.removeCustom = function(name) {
    var list = CsLinetypeStore.loadCustom().linetypes;
    var at = CsLinetypeStore.indexOf(list, name);
    if (at < 0) {
        return "No linetype called " + name + " in your library.";
    }
    list.splice(at, 1);
    return CsLinetypeStore.writeText(CsLinetypeStore.customPath(),
        CsLinetype.writeLin(list));
};

/** Every linetype in a drawing as a model, built-ins left out. */
CsLinetypeStore.fromDocument = function(doc) {
    var out = [];
    var names = doc.getLinetypeNames();
    for (var i = 0; i < names.length; i++) {
        var name = String(names[i]);
        if (CsLinetypeStore.BUILT_IN.indexOf(name.toUpperCase()) >= 0) {
            continue;
        }
        var lt = doc.queryLinetype(name);
        if (isNull(lt)) {
            continue;
        }
        var r = CsLinetype.fromPattern(String(lt.getPatternString()));
        if (r.errors.length > 0 || r.segments.length === 0) {
            continue;
        }
        out.push({ name: name, description: String(lt.getDescription()),
                   segments: r.segments });
    }
    return out;
};

/**
 * Adds the linetype to the drawing, or replaces the pattern of the one
 * already there under that name.
 *
 * RAddObjectOperation's second argument is FALSE on purpose: true (the
 * default) stamps the current attributes over the object -- the trap the
 * Symbol Palette found moving blocks between documents.
 *
 * \return null on success, else a sentence.
 */
CsLinetypeStore.applyToDocument = function(doc, di, model) {
    var problems = CsLinetype.validate(model);
    if (problems.length > 0) {
        return problems.join(" ");
    }
    var pat = new RLinetypePattern(doc.isMetric(), model.name, model.description || "");
    if (!pat.setPatternString(CsLinetype.toPattern(model))) {
        return "CaveCAD refused the pattern " + CsLinetype.toPattern(model) + ".";
    }
    var lt = doc.queryLinetype(model.name);
    if (isNull(lt)) {
        lt = new RLinetype(doc, pat);
    } else {
        lt.setPattern(pat);
    }
    di.applyOperation(new RAddObjectOperation(lt, false));

    var back = doc.queryLinetype(model.name);
    if (isNull(back)) {
        return "The linetype did not land in the drawing.";
    }
    return null;
};

/** The template pour's step: every custom linetype into a new drawing. */
CsLinetypeStore.applyAll = function(doc, di) {
    var list = CsLinetypeStore.loadCustom().linetypes;
    var failed = [];
    for (var i = 0; i < list.length; i++) {
        if (CsLinetypeStore.applyToDocument(doc, di, list[i]) !== null) {
            failed.push(list[i].name);
        }
    }
    return failed;
};
```

Add `include(includeBasePath + "/CsLinetypeStore.js");` to `CsAll.js` after CsLinetype. Add to `CORE_FILES_NOT_LOADED` in js_unit.js:
```js
    // Reads and writes the caver's .lin library through QFile and adds
    // linetypes to a real RDocument. Covered by tests/linetype_maker_run.js.
    "scripts/CaveSurvey/Core/CsLinetypeStore.js",
```

- [ ] **Step 3: Run** the Verify command → `### LINETYPE MAKER OK`; js_unit (both engines) and structural tests green. If `lt.setPattern` or `getDescription` is not bound, probe with a one-line autostart script and use `setPatternString`/the model's description instead; record the finding in the spec's As-built section.

- [ ] **Step 4: Commit** — `git add scripts/CaveSurvey/Core/CsLinetypeStore.js scripts/CaveSurvey/Core/CsAll.js tests/linetype_maker_run.js tests/js_unit.js tests/run_all.sh && git commit -m "feat: CsLinetypeStore -- personal .lin library, apply to drawing"`

---

### Task 5: Linetype Maker dock

**Goal:** A docked panel to pick, edit, preview, save and apply linetypes, on the Cave Survey menu as `linetypemaker` / `ltm`.

**Files:**
- Create: `scripts/CaveSurvey/LinetypeMaker/LinetypeMaker.js`, `LinetypeMaker.svg`, `LinetypeMaker-inverse.svg`
- Modify: `tests/test_addon.py` (MENU row, PANEL_OPENERS)
- Modify: `README.md` (tool row), `docs/handbook/pages/linetype-maker.html` (new), `docs/handbook/index.json`

**Acceptance Criteria:**
- [ ] Structural suite green (menu table, panel opener, icons, status tip, README row, handbook page)
- [ ] Live over the MCP bridge: dock `CaveSurveyLinetypeMakerDock` exists after startup, toggles from the menu, shows library + drawing linetypes
- [ ] Editing a row updates preview and the problems line; Save writes the library; Apply adds the linetype to the open drawing

**Verify:** `python3 -m unittest discover -s tests` → OK; live checks via `cavecad_eval`.

**Steps:**

- [ ] **Step 1: Structural test first** — in `tests/test_addon.py` MENU under `# 452 -- draw the map` add
`"LinetypeMaker/LinetypeMaker.js":     (452, 50, ["linetypemaker", "ltm"]),`
and add `"LinetypeMaker"` to `PANEL_OPENERS`. Run the structural suite → fails (file missing).

- [ ] **Step 2: Icons** — `LinetypeMaker.svg` (dark strokes) and `LinetypeMaker-inverse.svg` (same, `stroke="#ffffff"`/`fill="#ffffff"`):

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <g fill="none" stroke="#222222" stroke-width="2" stroke-linecap="round">
    <line x1="2" y1="7" x2="7" y2="7"/>
    <line x1="17" y1="7" x2="22" y2="7"/>
    <line x1="2" y1="17" x2="5" y2="17"/>
    <line x1="9" y1="17" x2="12" y2="17"/>
    <line x1="16" y1="17" x2="19" y2="17"/>
  </g>
  <text x="12" y="10" font-family="sans-serif" font-size="7" text-anchor="middle" fill="#222222">AB</text>
</svg>
```

- [ ] **Step 3: The tool** `scripts/CaveSurvey/LinetypeMaker/LinetypeMaker.js`:

```js
// LinetypeMaker.js -- Linetype Maker: make, edit and import linetypes.
//
// A docked panel over Core/CsLinetype (the pattern as data) and
// Core/CsLinetypeStore (the caver's .lin library and the open drawing).
// Built in init() and left hidden, like every dock in the suite: the
// main window's restoreState() runs after add-on init and can only place
// a dock that already exists. The menu action is setForceGlobal so it
// runs in the application engine where init built the dock.

include("scripts/EAction.js");
include(includeBasePath + "/../Core/CsAll.js");

var csLinetypeMakerDock;

function LinetypeMaker(guiAction) {
    EAction.call(this, guiAction);
}

LinetypeMaker.prototype = new EAction();

/** Table columns, in order. Kind is derived, never typed. */
LinetypeMaker.COLUMNS = ["Kind", "Length", "Text", "Font", "Size", "Rot°", "X", "Y"];

LinetypeMaker.PREVIEW_W = 280;
LinetypeMaker.PREVIEW_H = 56;

/** Widgets and the model being edited. One panel per window. */
LinetypeMaker.w = undefined;

LinetypeMaker.blank = function() {
    return { name: "", description: "", segments: [CsLinetype.segment(0.5),
                                                   CsLinetype.segment(-0.25)] };
};

LinetypeMaker.buildDock = function(appWin) {
    var dock = new QDockWidget(qsTr("Linetype Maker"), appWin);
    dock.objectName = "CaveSurveyLinetypeMakerDock";
    var w = { model: LinetypeMaker.blank(), entries: [], filling: false };
    var body = new QWidget(dock);
    var layout = new QVBoxLayout();
    layout.setContentsMargins(4, 4, 4, 4);
    layout.setSpacing(4);

    var pickRow = new QHBoxLayout();
    w.picker = new QComboBox();
    w.picker.toolTip = qsTr("Your library, then the linetypes already in this drawing.");
    pickRow.addWidget(w.picker, 1, 0);
    w.newButton = new QPushButton(qsTr("New"));
    pickRow.addWidget(w.newButton, 0, 0);
    w.deleteButton = new QPushButton(qsTr("Delete"));
    w.deleteButton.toolTip = qsTr("Remove it from your library (drawings keep their copy).");
    pickRow.addWidget(w.deleteButton, 0, 0);
    layout.addLayout(pickRow, 0);

    var form = new QGridLayout();
    form.addWidget(new QLabel(qsTr("Name")), 0, 0);
    w.name = new QLineEdit();
    form.addWidget(w.name, 0, 1);
    form.addWidget(new QLabel(qsTr("Description")), 1, 0);
    w.description = new QLineEdit();
    form.addWidget(w.description, 1, 1);
    layout.addLayout(form, 0);

    w.table = new QTableWidget(0, LinetypeMaker.COLUMNS.length);
    w.table.setHorizontalHeaderLabels(LinetypeMaker.COLUMNS);
    w.table.toolTip = qsTr("One row per dash (positive length), gap (negative) " +
        "or dot (0). A row with text draws it at the END of that row.");
    try {
        w.table.setMinimumHeight(150);
    } catch (eH) {
    }
    layout.addWidget(w.table, 1, 0);

    var rowButtons = new QHBoxLayout();
    w.addDash = new QPushButton(qsTr("+ Dash"));
    w.addGap = new QPushButton(qsTr("+ Gap"));
    w.addText = new QPushButton(qsTr("+ Text"));
    w.removeRow = new QPushButton(qsTr("Remove"));
    w.upRow = new QPushButton(qsTr("↑"));
    w.downRow = new QPushButton(qsTr("↓"));
    var rb = [w.addDash, w.addGap, w.addText, w.removeRow, w.upRow, w.downRow];
    for (var i = 0; i < rb.length; i++) {
        rowButtons.addWidget(rb[i], 0, 0);
    }
    layout.addLayout(rowButtons, 0);

    w.preview = new QLabel("");
    try {
        w.preview.setMinimumHeight(LinetypeMaker.PREVIEW_H);
    } catch (eP) {
    }
    layout.addWidget(w.preview, 0, 0);
    w.problems = new QLabel("");
    w.problems.wordWrap = true;
    layout.addWidget(w.problems, 0, 0);

    var foot = new QHBoxLayout();
    w.saveButton = new QPushButton(qsTr("Save to Library"));
    w.applyButton = new QPushButton(qsTr("Apply to Drawing"));
    w.importButton = new QPushButton(qsTr("Import…"));
    foot.addWidget(w.saveButton, 0, 0);
    foot.addWidget(w.applyButton, 0, 0);
    foot.addWidget(w.importButton, 0, 0);
    layout.addLayout(foot, 0);

    body.setLayout(layout);
    dock.setWidget(body);
    LinetypeMaker.w = w;

    function on(signal, fn) {
        try {
            signal.connect(fn);
        } catch (eConnect) {
            warning("Linetype Maker: a control could not be wired (" + eConnect + ")");
        }
    }
    on(w.picker.activated, function(index) { LinetypeMaker.pick(index); });
    on(w.newButton.clicked, function() { LinetypeMaker.load(LinetypeMaker.blank()); });
    on(w.deleteButton.clicked, function() { LinetypeMaker.remove(); });
    on(w.name.textEdited, function() { LinetypeMaker.readForm(); });
    on(w.description.textEdited, function() { LinetypeMaker.readForm(); });
    on(w.table.cellChanged, function() { LinetypeMaker.readForm(); });
    on(w.addDash.clicked, function() { LinetypeMaker.addRow(0.5, false); });
    on(w.addGap.clicked, function() { LinetypeMaker.addRow(-0.25, false); });
    on(w.addText.clicked, function() { LinetypeMaker.addRow(-0.5, true); });
    on(w.removeRow.clicked, function() { LinetypeMaker.moveRow(0); });
    on(w.upRow.clicked, function() { LinetypeMaker.moveRow(-1); });
    on(w.downRow.clicked, function() { LinetypeMaker.moveRow(1); });
    on(w.saveButton.clicked, function() { LinetypeMaker.save(); });
    on(w.applyButton.clicked, function() { LinetypeMaker.apply(); });
    on(w.importButton.clicked, function() { LinetypeMaker.importFile(); });
    on(dock.visibilityChanged, function(shown) {
        if (shown) {
            LinetypeMaker.refresh();
        }
    });

    appWin.addDockWidget(Qt.RightDockWidgetArea, dock);
    CsPanel.attachHelp(dock, "LinetypeMaker", qsTr("Linetype Maker"));
    return dock;
};

LinetypeMaker.ensureDock = function() {
    if (isNull(csLinetypeMakerDock)) {
        csLinetypeMakerDock = LinetypeMaker.buildDock(RMainWindowQt.getMainWindow());
    }
    return csLinetypeMakerDock;
};

/** Rebuilds the picker: library first, then the open drawing's own. */
LinetypeMaker.refresh = function() {
    var w = LinetypeMaker.w;
    w.entries = [];
    var lib = CsLinetypeStore.loadCustom();
    for (var i = 0; i < lib.linetypes.length; i++) {
        w.entries.push({ source: "library", model: lib.linetypes[i] });
    }
    var doc = EAction.getDocument();
    if (!isNull(doc)) {
        var drawn = CsLinetypeStore.fromDocument(doc);
        for (var d = 0; d < drawn.length; d++) {
            if (CsLinetypeStore.indexOf(lib.linetypes, drawn[d].name) < 0) {
                w.entries.push({ source: "drawing", model: drawn[d] });
            }
        }
    }
    w.picker.clear();
    w.picker.addItem(qsTr("— choose a linetype —"));
    for (var k = 0; k < w.entries.length; k++) {
        var e = w.entries[k];
        w.picker.addItem((e.source === "library" ? qsTr("Library: ") :
            qsTr("Drawing: ")) + e.model.name);
    }
    if (lib.errors.length > 0) {
        w.problems.text = qsTr("Some library lines could not be read: ") +
            lib.errors.join("; ");
    }
    LinetypeMaker.render();
};

LinetypeMaker.pick = function(index) {
    var w = LinetypeMaker.w;
    if (index < 1 || index > w.entries.length) {
        return;
    }
    LinetypeMaker.load(JSON.parse(JSON.stringify(w.entries[index - 1].model)));
};

/** Puts a model into the form. */
LinetypeMaker.load = function(model) {
    var w = LinetypeMaker.w;
    w.model = model;
    w.filling = true;
    try {
        w.name.text = model.name;
        w.description.text = model.description || "";
        w.table.setRowCount(model.segments.length);
        for (var r = 0; r < model.segments.length; r++) {
            var s = model.segments[r];
            var cells = [CsLinetype.kindOf(s), CsLinetype.num(s.length), s.text,
                s.style, CsLinetype.num(s.scale), CsLinetype.num(s.rotation),
                CsLinetype.num(s.x), CsLinetype.num(s.y)];
            for (var c = 0; c < cells.length; c++) {
                var item = new QTableWidgetItem(String(cells[c]));
                if (c === 0) {
                    try {
                        item.setFlags(Qt.ItemIsSelectable | Qt.ItemIsEnabled);
                    } catch (eFlags) {
                    }
                }
                w.table.setItem(r, c, item);
            }
        }
    } finally {
        w.filling = false;
    }
    LinetypeMaker.render();
};

LinetypeMaker.cell = function(r, c) {
    var item = LinetypeMaker.w.table.item(r, c);
    return isNull(item) ? "" : String(item.text()).trim();
};

/** Reads the form back into the model; never while load() is filling. */
LinetypeMaker.readForm = function() {
    var w = LinetypeMaker.w;
    if (w.filling) {
        return;
    }
    var m = { name: String(w.name.text).trim(),
              description: String(w.description.text).trim(), segments: [] };
    for (var r = 0; r < w.table.rowCount; r++) {
        var s = CsLinetype.segment(Number(LinetypeMaker.cell(r, 1)));
        s.text = LinetypeMaker.cell(r, 2);
        s.style = LinetypeMaker.cell(r, 3);
        s.scale = LinetypeMaker.cell(r, 4) === "" ? 1 : Number(LinetypeMaker.cell(r, 4));
        s.rotation = Number(LinetypeMaker.cell(r, 5)) || 0;
        s.x = Number(LinetypeMaker.cell(r, 6)) || 0;
        s.y = Number(LinetypeMaker.cell(r, 7)) || 0;
        m.segments.push(s);
    }
    w.model = m;
    w.filling = true;
    try {
        for (var k = 0; k < m.segments.length; k++) {
            var kind = w.table.item(k, 0);
            if (!isNull(kind)) {
                kind.setText(CsLinetype.kindOf(m.segments[k]));
            }
        }
    } finally {
        w.filling = false;
    }
    LinetypeMaker.render();
};

LinetypeMaker.addRow = function(length, withText) {
    var m = LinetypeMaker.w.model;
    var s = CsLinetype.segment(length);
    if (withText) {
        s.text = "TEXT";
        s.style = "standard";
        s.scale = 0.1;
        s.y = -0.05;
    }
    m.segments.push(s);
    LinetypeMaker.load(m);
};

/** delta 0 removes the current row; -1 / 1 moves it. */
LinetypeMaker.moveRow = function(delta) {
    var w = LinetypeMaker.w;
    var r = w.table.currentRow();
    var segs = w.model.segments;
    if (r < 0 || r >= segs.length) {
        return;
    }
    if (delta === 0) {
        segs.splice(r, 1);
    } else {
        var to = r + delta;
        if (to < 0 || to >= segs.length) {
            return;
        }
        var t = segs[r];
        segs[r] = segs[to];
        segs[to] = t;
        r = to;
    }
    LinetypeMaker.load(w.model);
    try {
        w.table.setCurrentCell(Math.min(r, segs.length - 1), 1);
    } catch (eCur) {
    }
};

/** Preview + problems line. */
LinetypeMaker.render = function() {
    var w = LinetypeMaker.w;
    var problems = CsLinetype.validate(w.model);
    w.problems.text = problems.join("\n");
    w.saveButton.enabled = problems.length === 0;
    w.applyButton.enabled = problems.length === 0 && !isNull(EAction.getDocument());
    try {
        w.preview.setPixmap(LinetypeMaker.previewPixmap(w.model));
    } catch (ePix) {
        w.preview.text = CsLinetype.toPattern(w.model);
    }
};

/**
 * Three periods of the pattern along a straight line. Dashes and dots
 * from CsLinetype.layout; each text from the ENGINE's own glyph paths
 * (RLinetypePattern.getShapeAt), so the preview shows the font CaveCAD
 * will draw. A bridge that cannot paint an RPainterPath falls back to
 * drawText.
 */
LinetypeMaker.previewPixmap = function(model) {
    var W = LinetypeMaker.PREVIEW_W, H = LinetypeMaker.PREVIEW_H;
    var pixmap = new QPixmap(W, H);
    pixmap.fill(new QColor(0, 0, 0, 0));
    var period = 0;
    for (var i = 0; i < model.segments.length; i++) {
        period += Math.abs(Number(model.segments[i].length) || 0);
    }
    if (!(period > 0)) {
        return pixmap;
    }
    var margin = 8;
    var f = (W - 2 * margin) / (3 * period);
    var y0 = H / 2;
    var lay = CsLinetype.layout(model, 3 * period);

    var engine = null;
    try {
        engine = new RLinetypePattern(true, "PREVIEW", "");
        if (!engine.setPatternString(CsLinetype.toPattern(model))) {
            engine = null;
        }
    } catch (eEng) {
        engine = null;
    }

    var painter = new QPainter();
    painter.begin(pixmap);
    try {
        painter.setRenderHint(QPainter.Antialiasing, true);
        var pen = new QPen(new QColor(40, 40, 40));
        pen.setWidth(2);
        painter.setPen(pen);
        for (var d = 0; d < lay.dashes.length; d++) {
            painter.drawLine(margin + lay.dashes[d][0] * f, y0,
                             margin + lay.dashes[d][1] * f, y0);
        }
        for (var p = 0; p < lay.dots.length; p++) {
            painter.drawPoint(margin + lay.dots[p] * f, y0);
        }
        pen.setWidth(1);
        painter.setPen(pen);
        for (var g = 0; g < lay.glyphs.length; g++) {
            var seg = model.segments[lay.glyphs[g].index];
            var gx = margin + lay.glyphs[g].at * f;
            var drawn = false;
            if (engine !== null) {
                try {
                    var paths = engine.getShapeAt(lay.glyphs[g].index);
                    painter.save();
                    painter.translate(gx, y0);
                    painter.scale(f, -f);
                    for (var k = 0; k < paths.length; k++) {
                        painter.drawPath(paths[k]);
                    }
                    painter.restore();
                    drawn = paths.length > 0;
                } catch (ePath) {
                    drawn = false;
                }
            }
            if (!drawn) {
                painter.drawText(gx + seg.x * f, y0 - seg.y * f, seg.text);
            }
        }
    } finally {
        painter.end();
    }
    return pixmap;
};

LinetypeMaker.save = function() {
    var err = CsLinetypeStore.saveCustom(LinetypeMaker.w.model);
    if (err !== null) {
        CsTell.warn(err);
        return;
    }
    EAction.handleUserMessage(qsTr("Linetype Maker: saved ") +
        LinetypeMaker.w.model.name + qsTr(" to ") + CsLinetypeStore.customPath());
    LinetypeMaker.refresh();
};

LinetypeMaker.apply = function() {
    var doc = EAction.getDocument();
    var di = EAction.getDocumentInterface();
    if (isNull(doc) || isNull(di)) {
        CsTell.warn(qsTr("Open a drawing first."));
        return;
    }
    var err = CsLinetypeStore.applyToDocument(doc, di, LinetypeMaker.w.model);
    if (err !== null) {
        CsTell.warn(err);
        return;
    }
    EAction.handleUserMessage(qsTr("Linetype Maker: ") + LinetypeMaker.w.model.name +
        qsTr(" is in this drawing -- pick it from any layer or entity's linetype list."));
    LinetypeMaker.refresh();
};

LinetypeMaker.remove = function() {
    var name = LinetypeMaker.w.model.name;
    var err = CsLinetypeStore.removeCustom(name);
    if (err !== null) {
        CsTell.warn(err);
        return;
    }
    LinetypeMaker.load(LinetypeMaker.blank());
    LinetypeMaker.refresh();
};

LinetypeMaker.prototype.beginEvent = function() {
    EAction.prototype.beginEvent.call(this);
    try {
        var dock = LinetypeMaker.ensureDock();
        dock.visible = !dock.visible;
        if (dock.visible) {
            dock.raise();
        }
    } catch (e) {
        csLinetypeMakerDock = undefined;
        CsTell.warn("Linetype Maker: this CaveCAD build refused the docked panel (" +
            e + ") -- please report this.");
    }
    this.terminate();
};

LinetypeMaker.init = function(basePath) {
    LinetypeMaker.basePath = basePath;
    var action = new RGuiAction(qsTr("Linetype Maker"), RMainWindowQt.getMainWindow());
    action.setRequiresDocument(true);
    action.setForceGlobal(true);
    action.setScriptFile(basePath + "/LinetypeMaker.js");
    action.setIcon(basePath + "/LinetypeMaker.svg");
    action.setStatusTip(qsTr("Make, edit and import linetypes -- dashes, gaps and text"));
    action.setDefaultCommands(["linetypemaker", "ltm"]);
    action.setGroupSortOrder(452);
    action.setSortOrder(50);
    action.setWidgetNames(["CaveSurveyMenu", "CaveSurveyToolBar"]);
    try {
        var dock = LinetypeMaker.ensureDock();
        dock.visible = false;
    } catch (eInit) {
        csLinetypeMakerDock = undefined;
        warning("Linetype Maker: could not build the panel at startup (" +
            eInit + "); the menu entry will try again.");
    }
};
```

`LinetypeMaker.importFile` is Task 6; until then add a stub-free placeholder by leaving the Import button out of Step 3 and adding it in Task 6 — i.e. in this task omit the `w.importButton` lines and its `on(...)` wiring.

- [ ] **Step 4: README row** in "## The tools" table, after the Shaped Lines row:

```
| Linetype Maker | `ltm` | Make and edit your own linetypes: dashes, gaps, dots and TEXT drawn into the line (for example a `W` every few feet along a water line). Rows are the repeating pattern -- positive length draws, negative leaves a gap, 0 is a dot; a row with text draws it at the end of that row. **Save to Library** keeps it in `~/Documents/Cave/linetypes/CaveCustomLinetypes.lin` (beside your caves, so it syncs and no update touches it); **Apply to Drawing** adds it to the open drawing, and every new cave map gets your whole library. **Import...** reads AutoCAD `.lin` files and the linetypes inside another DXF. Text linetypes are saved as real DXF linetypes, so other CAD programs show them too. |
```

- [ ] **Step 5: Handbook** — `docs/handbook/pages/linetype-maker.html`:

```html
<h1>Linetype Maker</h1>
<p>Make, edit and import your own linetypes. <code>ltm</code></p>
<h2>When you reach for it</h2>
<p>When a line on your map needs to say what it is along its whole length: a stream that repeats <code>W</code>, a survey boundary that repeats <code>LIMIT</code>, or just a dash pattern the template does not have.</p>
<h2>How it works</h2>
<ol>
<li>Pick a linetype from the list, or press <b>New</b>.</li>
<li>Give it a name (letters, digits, <code>_ - $</code>; no spaces).</li>
<li>Edit the rows. A positive <b>Length</b> draws a dash, a negative one leaves a gap, 0 is a dot. Type in <b>Text</b> and the text is drawn at the end of that row; <b>Size</b> is its height, <b>X</b>/<b>Y</b> nudge it, <b>Rot°</b> turns it.</li>
<li>Watch the preview; anything wrong is listed under it.</li>
<li><b>Save to Library</b> to keep it, <b>Apply to Drawing</b> to use it now.</li>
</ol>
<h2>Good to know</h2>
<p>Your library is one file beside your caves, <code>Documents/Cave/linetypes/CaveCustomLinetypes.lin</code>. It syncs with them and no CaveCAD update ever replaces it. Every new cave map gets the whole library.</p>
<p>Text inside a linetype cannot contain spaces or commas.</p>
<p>Symbols drawn into a line (ticks, chevrons) are coming next; until then use <a href="shaped-lines.html">Shaped Lines</a>.</p>
<h2>See also</h2>
<ul><li><a href="shaped-lines.html">Shaped Lines</a></li><li><a href="words-layers.html">Layers</a></li></ul>
```

`docs/handbook/index.json` — add after the `symbol-palette` entry:
```json
    {
      "id": "linetype-maker",
      "title": "Linetype Maker",
      "class": "tool",
      "file": "linetype-maker.html",
      "stage": 452,
      "tools": [
        "LinetypeMaker"
      ],
      "shots": []
    },
```

- [ ] **Step 6: Run structural + js suites** — `python3 -m unittest discover -s tests` and `./tests/run_all.sh` → green.

- [ ] **Step 7: Commit** — `git add scripts/CaveSurvey/LinetypeMaker tests/test_addon.py README.md docs/handbook && git commit -m "feat: Linetype Maker panel -- edit, preview, save, apply"`

---

### Task 6: Import `.lin` and DXF linetypes

**Goal:** Import… reads a `.lin` or a `.dxf`, lets the caver tick which linetypes to keep, and saves them to the library.

**Files:**
- Modify: `scripts/CaveSurvey/LinetypeMaker/LinetypeMaker.js`
- Modify: `tests/linetype_maker_run.js` (readImport coverage)
- Create: `testdata/linetypes/cave-sample.lin`

**Acceptance Criteria:**
- [ ] `LinetypeMaker.readImport(path)` on `testdata/linetypes/cave-sample.lin` returns 2 linetypes, 0 errors
- [ ] `readImport` on the Task 2 round-trip DXF returns its `CSRT` linetype with text intact
- [ ] Import… button: Qt file dialog → checkbox dialog listing names (existing library names marked "replaces yours") → ticked ones saved

**Verify:** `$QCAD ... -autostart tests/linetype_maker_run.js "$PWD"` → `### LINETYPE MAKER OK`

**Steps:**

- [ ] **Step 1: Test data** `testdata/linetypes/cave-sample.lin`:

```
;; Sample linetypes for Linetype Maker's import test.
*CS_WATER,Stream ---- W ---- W ----
A,1.0,-0.25,["W",standard,S=0.12,X=-0.05,Y=-0.06],-0.25
*CS_DASHDOT,Dash dot __ . __ .
A,0.5,-0.25,0,-0.25
```

- [ ] **Step 2: Failing test** — in `tests/linetype_maker_run.js` load the tool file's pure function by evaluating `LinetypeMaker.readImport` only: add before the final OK:

```js
// Import reading, without the dialog. LinetypeMaker.js needs the GUI to
// load, so its reader lives on CsLinetypeStore.
var sample = CsLinetypeStore.readImport(repo + "/testdata/linetypes/cave-sample.lin");
check(sample.errors.length === 0, "sample .lin: " + sample.errors.join("; "));
check(sample.linetypes.length === 2, "sample .lin: " + sample.linetypes.length);
check(sample.linetypes[0].segments[1].text === "W", "sample .lin lost its W");

var dxfPath = QDir.tempPath() + "/cs_linetype_CSRT.dxf";
if (new QFileInfo(dxfPath).exists()) {
    var fromDxf = CsLinetypeStore.readImport(dxfPath);
    var got = null;
    for (var j = 0; j < fromDxf.linetypes.length; j++) {
        if (fromDxf.linetypes[j].name.toUpperCase() === "CSRT") {
            got = fromDxf.linetypes[j];
        }
    }
    check(got !== null, "DXF import did not list CSRT");
    check(got.segments[1].text === "CAVE", "DXF import lost the text");
}
```
(Stage ordering: run_all runs the round-trip stage before this one, which leaves that file.) Run → fails.

- [ ] **Step 3: Reader** in `CsLinetypeStore.js`:

```js
/**
 * Linetypes from a file a caver picked: a .lin read as text, anything
 * else opened as a drawing offscreen and its linetypes read back.
 * \return { linetypes, errors }
 */
CsLinetypeStore.readImport = function(path) {
    var p = String(path);
    if (/\.lin$/i.test(p)) {
        var text = CsLinetypeStore.readText(p);
        if (text === null) {
            return { linetypes: [], errors: ["Could not read " + p + "."] };
        }
        return CsLinetype.parseLin(text);
    }
    var di = new RDocumentInterface(
        new RDocument(new RMemoryStorage(), new RSpatialIndexNavel()));
    try {
        if (di.importFile(p, "", false) !== RDocumentInterface.IoErrorNoError) {
            return { linetypes: [], errors: ["CaveCAD could not open " + p + "."] };
        }
        return { linetypes: CsLinetypeStore.fromDocument(di.getDocument()), errors: [] };
    } finally {
        destr(di);
    }
};
```
(If `destr` is undefined headless, guard with `if (typeof destr === "function")`.)

- [ ] **Step 4: Dialog** — in `LinetypeMaker.js` restore the Import button lines from Task 5 Step 3, and add:

```js
LinetypeMaker.importFile = function() {
    var path = CsFiles.openFile(RMainWindowQt.getMainWindow(),
        qsTr("Import linetypes"), QDir.homePath(),
        qsTr("Linetypes (*.lin *.dxf);;All files (*)"));
    if (isNull(path) || String(path) === "") {
        return;
    }
    var found = CsLinetypeStore.readImport(path);
    if (found.linetypes.length === 0) {
        CsTell.warn(qsTr("No linetypes found in ") + path +
            (found.errors.length > 0 ? " -- " + found.errors.join("; ") : "."));
        return;
    }
    var mine = CsLinetypeStore.loadCustom().linetypes;

    var dialog = new QDialog(RMainWindowQt.getMainWindow());
    dialog.windowTitle = qsTr("Import linetypes");
    var v = new QVBoxLayout();
    var boxes = [];
    for (var i = 0; i < found.linetypes.length; i++) {
        var lt = found.linetypes[i];
        var label = lt.name + (lt.description ? " -- " + lt.description : "");
        if (CsLinetypeStore.indexOf(mine, lt.name) >= 0) {
            label += qsTr("  (replaces yours)");
        }
        var box = new QCheckBox(label);
        box.checked = CsLinetype.validate(lt).length === 0;
        box.enabled = box.checked;
        v.addWidget(box, 0, 0);
        boxes.push(box);
    }
    if (found.errors.length > 0) {
        var errs = new QLabel(qsTr("Skipped: ") + found.errors.join("; "));
        errs.wordWrap = true;
        v.addWidget(errs, 0, 0);
    }
    var buttons = new QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel);
    buttons.accepted.connect(dialog, "accept");
    buttons.rejected.connect(dialog, "reject");
    v.addWidget(buttons, 0, 0);
    dialog.setLayout(v);
    if (dialog.exec() !== QDialog.Accepted.valueOf()) {
        return;
    }
    var saved = 0, failed = [];
    for (var k = 0; k < boxes.length; k++) {
        if (!boxes[k].checked) {
            continue;
        }
        var err = CsLinetypeStore.saveCustom(found.linetypes[k]);
        if (err === null) {
            saved++;
        } else {
            failed.push(found.linetypes[k].name + ": " + err);
        }
    }
    if (failed.length > 0) {
        CsTell.warn(failed.join("\n"));
    }
    EAction.handleUserMessage(qsTr("Linetype Maker: imported ") + saved +
        qsTr(" linetype(s) into your library."));
    LinetypeMaker.refresh();
};
```

Check `tests/test_addon.py::test_no_signal_connects_to_a_slot_name` — if it forbids `connect(dialog, "accept")`, use `buttons.accepted.connect(function() { dialog.accept(); })` (and the same for reject). Check `qcad-js-bridge-traps` memory for `exec()` return comparison and QCheckBox availability before running live.

- [ ] **Step 5: Run** the Verify command, structural suite, full `run_all.sh` → green.

- [ ] **Step 6: Commit** — `git add scripts/CaveSurvey testdata/linetypes tests/linetype_maker_run.js && git commit -m "feat: Linetype Maker imports .lin files and DXF linetypes"`

---

### Task 7: New cave maps get the library

**Goal:** The template pour adds every custom linetype into each new drawing.

**Files:**
- Modify: `scripts/CaveSurvey/CaveTemplate/CaveTemplateApply.js`
- Modify: `tests/cave_template_run.js` (assert a custom lands)

**Acceptance Criteria:**
- [ ] With a library holding `CSA`, a template pour yields a document with linetype `CSA`
- [ ] With no library file, the pour behaves exactly as before

**Verify:** `$QCAD ... -autostart tests/cave_template_run.js "$PWD"` → its existing OK marker

**Steps:**

- [ ] **Step 1: Failing test** — read `tests/cave_template_run.js`, find where it runs `initNewFile` on a document, and before that set `CsLinetypeStore.pathOverride` to a temp library containing `*CSA,test\nA,1,-0.5\n`; after the pour assert `!isNull(doc.queryLinetype("CSA"))`; reset `pathOverride = null` afterwards. Run → fails.

- [ ] **Step 2: Implement** — in `CaveTemplateApply.js`, right after the Layer Manager `try { ... } catch (eGroups) { ... }` block:

```js
        // The caver's own linetypes (Linetype Maker). They live in their
        // library beside the caves, not in the template, so a release
        // can never take them; this is how a new map gets them.
        try {
            if (typeof CsLinetypeStore !== "undefined") {
                var ltFailed = CsLinetypeStore.applyAll(di.getDocument(), di);
                if (ltFailed.length > 0) {
                    EAction.handleUserWarning("Cave template: these linetypes " +
                        "from your library could not be added: " + ltFailed.join(", "));
                }
            }
        } catch (eLinetypes) {
            // a library that will not read must not cost a new map
        }
```

- [ ] **Step 3: Run** Verify + `run_all.sh` → green.

- [ ] **Step 4: Commit** — `git add scripts/CaveSurvey/CaveTemplate/CaveTemplateApply.js tests/cave_template_run.js && git commit -m "feat: new cave maps get the caver's linetype library"`

---

### Task 8: Live check, version, publish

**Goal:** The panel verified in the running app, released as 0.9.182.0 and published.

**Files:**
- Modify: `VERSION` (→ `0.9.182.0`), spec As-built section

**Acceptance Criteria:**
- [ ] `./tests/run_all.sh --publish` → `ALL TESTS PASSED -- including publish checks`
- [ ] Live (MCP bridge, after a clean CaveCAD restart with no unsaved changes): dock builds, library + drawing linetypes listed, a text linetype applied to a line, drawing saved as DXF, reopened, line still shows the text linetype (screenshot)
- [ ] `tools/publish.sh` run; installed add-on version reads 0.9.182.0

**Verify:** `./tests/run_all.sh --publish` → `ALL TESTS PASSED -- including publish checks`

**Steps:**

- [ ] **Step 1:** `echo 0.9.182.0 > VERSION`; run `./tests/run_all.sh --publish`.
- [ ] **Step 2:** `tools/publish.sh`; restart CaveCAD (check the live-restart trap: no unsaved-changes prompt blocked the quit).
- [ ] **Step 3:** Live over `cavecad_eval`: `RMainWindowQt.getMainWindow().findChild("CaveSurveyLinetypeMakerDock")` non-null; trigger `ltm`; load the sample library; apply `CS_WATER`; draw a line with it; `exportFile` to a temp DXF; reopen; `cavecad_screenshot`.
- [ ] **Step 4:** Write the spec's `## As-built` section (what diverged: preview drawPath result, any binding probes, import dialog shape). Commit: `git add VERSION docs && git commit -m "release: 0.9.182.0 -- Linetype Maker (dashes + text)"`.
