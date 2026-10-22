"""Mockup helper (design gate C): render page 1 of the real gate poster PDF to a PNG thumbnail.
Run from backend/:  PYTHONPATH=. uv run python ../docs/design-refs/m2/gate-c/render_poster.py"""

import sys
from pathlib import Path

import pypdfium2
from app.modules.printing.poster_pdf import gate_poster_pdf

out = Path(__file__).resolve().parent / "screenshots"
for plant_name, code in [
    ("Sheet Shapers India Pvt Ltd (K-134)", "K134"),
    ("Sheet Shapers India Pvt Ltd (X-280)", "X280"),
]:
    pdf_bytes = gate_poster_pdf(plant_name, code, 60)
    if code == "K134":
        (out / "poster.pdf").write_bytes(pdf_bytes)
    page = pypdfium2.PdfDocument(pdf_bytes)[0]
    image = page.render(scale=0.5).to_pil().convert("RGB")
    image.save(out / f"poster-{code.lower()}.png", optimize=True)
    print("saved", code, image.size, file=sys.stdout)
