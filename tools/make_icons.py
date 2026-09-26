#!/usr/bin/env python3
"""Regenerate CaveCAD's platform icons from its two masters.

    python3 tools/make_icons.py <app-tile-1024.png>

<app-tile-1024.png> is the square app icon (the traverse "C" on its grid
tile), e.g. exported from src/run/cavecad.icns with
    sips -s format png src/run/cavecad.icns --out tile.png
The document icon is drawn here: a page with a folded corner carrying the
same traverse, so a CaveCAD drawing and the app are recognisably kin.

Writes (needs Pillow; macOS also needs iconutil for the .icns):
    src/run/cavecad.ico       Windows app icon
    src/run/cavecaddoc.ico    Windows document icon
    src/run/document.icns     macOS document icon
    scripts/mimetype.png      Linux document icon (128 px)
    scripts/doc/qcad_icon.png the scripts root's help icon (48 px; the
                              name is QCAD's convention, the picture is not)
"""
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GLYPH = os.path.join(ROOT, "scripts", "cavecad_icon.png")  # transparent traverse
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]

PAPER = (247, 245, 241, 255)   # the tile's paper colour
EDGE = (30, 38, 52, 255)       # the traverse's ink
FOLD = (226, 222, 214, 255)


def document(size=1024):
    """A page with a folded corner and the traverse on it."""
    s = size
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    left, top, right, bottom = int(s * .17), int(s * .06), int(s * .83), int(s * .94)
    fold = int(s * .20)
    w = max(2, s // 64)
    page = [(left, top), (right - fold, top), (right, top + fold),
            (right, bottom), (left, bottom)]
    d.polygon(page, fill=PAPER)
    d.line(page + [page[0]], fill=EDGE, width=w, joint="curve")
    corner = [(right - fold, top), (right - fold, top + fold), (right, top + fold)]
    d.polygon(corner, fill=FOLD)
    d.line(corner, fill=EDGE, width=w, joint="curve")
    glyph = Image.open(GLYPH).convert("RGBA")
    g = int(s * .50)
    glyph = glyph.resize((g, g), Image.LANCZOS)
    img.alpha_composite(glyph, (int((s - g) / 2), int(s * .30)))
    return img


def write_icns(master, out):
    """macOS .icns through iconutil, the only writer Apple guarantees."""
    if shutil.which("iconutil") is None:
        print("iconutil not found (not macOS?): skipped", out)
        return
    tmp = tempfile.mkdtemp()
    iconset = os.path.join(tmp, "icon.iconset")
    os.mkdir(iconset)
    for px in (16, 32, 128, 256, 512):
        master.resize((px, px), Image.LANCZOS).save(
            os.path.join(iconset, "icon_%dx%d.png" % (px, px)))
        master.resize((px * 2, px * 2), Image.LANCZOS).save(
            os.path.join(iconset, "icon_%dx%d@2x.png" % (px, px)))
    subprocess.check_call(["iconutil", "-c", "icns", iconset, "-o", out])
    shutil.rmtree(tmp)


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    tile = Image.open(sys.argv[1]).convert("RGBA").resize((1024, 1024), Image.LANCZOS)
    doc = document()

    tile.save(os.path.join(ROOT, "src/run/cavecad.ico"), sizes=ICO_SIZES)
    doc.save(os.path.join(ROOT, "src/run/cavecaddoc.ico"), sizes=ICO_SIZES)
    write_icns(doc, os.path.join(ROOT, "src/run/document.icns"))
    doc.resize((128, 128), Image.LANCZOS).save(os.path.join(ROOT, "scripts/mimetype.png"))
    tile.resize((48, 48), Image.LANCZOS).save(os.path.join(ROOT, "scripts/doc/qcad_icon.png"))
    print("icons written")


if __name__ == "__main__":
    main()
