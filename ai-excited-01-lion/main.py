#!/usr/bin/env python3
"""Copy the lion entry image to the output path the judge reads."""

import hashlib
import os
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUTPUT_DIR = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    source = HERE / "entry.jpg"
    target = OUTPUT_DIR / "entry.png"
    shutil.copyfile(source, target)
    if sha256_of(source) != sha256_of(target):
        print("entry copy failed integrity check", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
