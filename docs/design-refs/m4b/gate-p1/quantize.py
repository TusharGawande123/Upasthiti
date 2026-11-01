# Palette-reduce raw PNGs (RAW_DIR) into screenshots/ (each under 400 KB). Needs Pillow: uv run --with pillow python quantize.py
import os, sys
from PIL import Image
here = os.path.dirname(os.path.abspath(__file__))
raw = os.environ.get("RAW_DIR", os.path.join(here, "raw"))
out = os.path.join(here, "screenshots")
os.makedirs(out, exist_ok=True)
biggest = 0
for f in sorted(os.listdir(raw)):
    if not f.endswith(".png"): continue
    im = Image.open(os.path.join(raw, f)).convert("RGB")
    for colors in (128, 64, 32):
        q = im.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        dst = os.path.join(out, f)
        q.save(dst, optimize=True)
        if os.path.getsize(dst) < 380_000: break
    biggest = max(biggest, os.path.getsize(dst))
print("done, largest", biggest // 1024, "KB")
