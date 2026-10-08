#!/usr/bin/env python3
"""Draw the macOS cursor into a recorded clip and encode it as a GIF.

    .venv/bin/python tools/demo/compose.py <frames dir> <out.gif> [--width 760]

<frames dir> is what CsDemo.record wrote: f0000.png ... plus track.json.
The cursor sits at the point the rig computed from the target widget's
real geometry, offset by the system cursor's own hotspot, so the arrow's
tip -- not its corner -- is what lands on the button.

Needs Pillow (the repo .venv has it) and ffmpeg.
"""
import json
import os
import subprocess
import sys

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))


def load_sprites(dpr):
    meta = json.load(open(os.path.join(HERE, "cursors", "cursors.json")))
    out = {}
    for name, m in meta["cursors"].items():
        img = Image.open(os.path.join(HERE, "cursors", m["file"])).convert("RGBA")
        size = (round(m["w"] * dpr), round(m["h"] * dpr))
        out[name] = (img.resize(size, Image.LANCZOS), m["hx"] * dpr, m["hy"] * dpr)
    return out


def draw_ripple(frame, rp, dpr):
    k = rp["k"]
    rad = (5 + 20 * k) * dpr
    layer = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = rp["x"] * dpr, rp["y"] * dpr
    box = (cx - rad, cy - rad, cx + rad, cy + rad)
    d.ellipse(box, fill=(255, 255, 255, round(50 * (1 - k))),
              outline=(255, 255, 255, round(170 * (1 - k))), width=max(1, round(2 * dpr)))
    return Image.alpha_composite(frame, layer)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    width = 760
    if "--width" in sys.argv:
        width = int(sys.argv[sys.argv.index("--width") + 1])
        args = [a for a in args if a != str(width)]
    src, out = args[0], args[1]
    track = json.load(open(os.path.join(src, "track.json")))
    dpr, fps = track["dpr"], track["fps"]
    sprites = load_sprites(dpr)
    comp = os.path.join(src, "composed")
    os.makedirs(comp, exist_ok=True)
    for f in track["frames"]:
        frame = Image.open(os.path.join(src, "f%04d.png" % f["n"])).convert("RGBA")
        if f["ripple"]:
            frame = draw_ripple(frame, f["ripple"], dpr)
        sprite, hx, hy = sprites[f["style"]]
        frame.paste(sprite, (round(f["x"] * dpr - hx), round(f["y"] * dpr - hy)), sprite)
        frame.convert("RGB").save(os.path.join(comp, "c%04d.png" % f["n"]))
    pal = os.path.join(comp, "palette.png")
    scale = "scale=%d:-1:flags=lanczos" % width
    inp = ["-framerate", str(fps), "-i", os.path.join(comp, "c%04d.png")]
    subprocess.check_call(["ffmpeg", "-loglevel", "error", "-y"] + inp +
        ["-vf", scale + ",palettegen=stats_mode=diff", pal])
    subprocess.check_call(["ffmpeg", "-loglevel", "error", "-y"] + inp + ["-i", pal,
        "-lavfi", scale + " [x]; [x][1:v] paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
        "-loop", "0", out])
    print(out, os.path.getsize(out), "bytes,", len(track["frames"]), "frames")


main()
