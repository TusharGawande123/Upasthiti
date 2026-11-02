"""Palette-reduces the screenshots (docs only). Run: backend/.venv/Scripts/python docs/design-refs/m4b/gate-p2/reduce.py"""

from pathlib import Path

from PIL import Image

folder = Path(__file__).parent / "screenshots"
biggest = 0
for path in sorted(folder.glob("*.png")):
    image = Image.open(path).convert("RGB")
    image.quantize(
        colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
    ).save(path, optimize=True)
    biggest = max(biggest, path.stat().st_size)
print(f"{len(list(folder.glob('*.png')))} files, largest {biggest // 1024} KB")
