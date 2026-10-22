"""Mockup helper (design gate C): shrink the screenshots so the folder stays under 8 MB (repo limit 1 MB per file).
Converts every PNG in screenshots/ to a 256-colour palette PNG (lossless enough for UI review).
Run from backend/:  uv run python ../docs/design-refs/m2/gate-c/compress_png.py"""

from pathlib import Path

from PIL import Image

folder = Path(__file__).resolve().parent / "screenshots"
for path in sorted(folder.glob("*.png")):
    before = path.stat().st_size
    image = Image.open(path).convert("RGB")
    image.quantize(
        colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE
    ).save(path, optimize=True)
    print(f"{path.name}: {before // 1024} KB -> {path.stat().st_size // 1024} KB")
