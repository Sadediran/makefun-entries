#!/usr/bin/env python3
"""Copy the entry image to the output directory.

The program writes one image, the image that makes the AI judge
happiest, to /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png
when set, for local runs). Standard library only, deterministic:
the same bytes every run.
"""

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
    print(f"wrote {dest} ({dest.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
