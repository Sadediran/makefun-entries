#!/usr/bin/env python3
"""Copy the entry image to the output directory.

The program writes one image, the image that makes the AI judge
happiest, to /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png
when set, for local runs). Standard library only, deterministic:
the same bytes every run.
"""

import hashlib
import os
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "image.png"

# Competition gate limits for the entry image.
MAX_BYTES = 1_048_576


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"entry image missing: {SOURCE}")
    size = SOURCE.stat().st_size
    if size > MAX_BYTES:
        raise ValueError(f"entry image too large: {size} bytes (limit {MAX_BYTES})")
    out_dir = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / "entry.png"
    shutil.copyfile(SOURCE, dest)
    if _sha256(dest) != _sha256(SOURCE):
        raise ValueError("copied image does not match the source")
    print(f"wrote {dest} ({dest.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
