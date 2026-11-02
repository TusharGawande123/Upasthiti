"""Palette-reduces the gate P3 screenshots so every PNG stays small (docs only, not app code).

Run: python docs/design-refs/m4b/gate-p3/reduce-png.py
Needs Pillow. Safe to run twice (a PNG that is already a palette image is skipped).
"""

from pathlib import Path

from PIL import Image

folder = Path(__file__).parent / "screenshots"
saved = 0
biggest = (0, "")
for png in sorted(folder.glob("*.png")):
    before = png.stat().st_size
    image = Image.open(png)
    if image.mode != "P":
        reduced = image.convert("RGB").quantize(
            colors=48, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
        )
        reduced.save(png, optimize=True)
    after = png.stat().st_size
    saved += before - after
    if after > biggest[0]:
        biggest = (after, png.name)
print(f"saved {saved // 1024} KB; largest: {biggest[1]} = {biggest[0] // 1024} KB")
