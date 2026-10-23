"""Makes INT8 copies of the face model packs (M3 extra S-33, measured in slice 1).

Dynamic INT8 quantisation (onnxruntime's free tool) stores the weights as 8-bit numbers, which can
cut memory and CPU time. The copies get their own folder (buffalo_l_int8, buffalo_s_int8) and so
their own model id: templates made with one are never compared with another. Accuracy of the INT8
copies must be measured again before they are used (spec section 12, S-33).

Needs the `onnx` package, which only the image build stage installs (never the runtime image).
Usage:  python scripts/quantise_models.py [--dest DIR]
"""

import argparse
import os
import sys
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic

DEFAULT_DEST = Path(os.environ.get("FACE_MODELS_DIR", "models"))
# The pack folders written by download_models.py and the two files used from each.
PACKS = {
    "buffalo_l": ("det_10g.onnx", "w600k_r50.onnx"),
    "buffalo_s": ("det_500m.onnx", "w600k_mbf.onnx"),
}


def quantise_pack(pack: str, files: tuple[str, ...], dest: Path) -> None:
    source_folder = dest / pack
    target_folder = dest / f"{pack}_int8"
    target_folder.mkdir(parents=True, exist_ok=True)
    for name in files:
        source = source_folder / name
        if not source.is_file():
            raise FileNotFoundError(f"{source} is missing: run download_models.py first")
        quantize_dynamic(str(source), str(target_folder / name), weight_type=QuantType.QUInt8)
        print(f"{pack}_int8/{name}: {(target_folder / name).stat().st_size} bytes")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Make INT8 copies of the face models.")
    parser.add_argument("--dest", type=Path, default=DEFAULT_DEST)
    args = parser.parse_args(argv)
    try:
        for pack, files in PACKS.items():
            quantise_pack(pack, files, args.dest)
    except (FileNotFoundError, OSError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
