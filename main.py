#!/usr/bin/env python3
"""Copy the entry image to the output directory.

The program writes one image, the food picture made to make the AI
judge hungry, to /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png
when set, for local runs). Standard library only, deterministic:
the same bytes every run.
"""

import hashlib
import os
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "image.png"


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(f"entry image missing: {SOURCE}")
    out_dir = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / "entry.png"
    shutil.copyfile(SOURCE, dest)
    # Prove the copy is exact: the grader runs the program twice and
    # both runs must write the same bytes.
    source_hash = hashlib.sha256(SOURCE.read_bytes()).hexdigest()
    dest_hash = hashlib.sha256(dest.read_bytes()).hexdigest()
    if source_hash != dest_hash:
        raise RuntimeError(f"copy mismatch: {SOURCE} -> {dest}")
    print(f"wrote {dest} ({dest.stat().st_size} bytes, sha256 {dest_hash[:16]}...)")


if __name__ == "__main__":
    main()
