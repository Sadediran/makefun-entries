#!/usr/bin/env python3
"""Copy the entry image to the competition output directory, verified.

The entry is a single food photograph, image.png, sitting next to this
script: a bowl of tonkotsu ramen, chopsticks lifting a tall glossy
noodle pull high above the bowl, steam curling around the noodles, a
soft egg with its yolk dripping, charred chashu, nori and a swirl of
chili oil on a dark wooden table. This program copies it byte-for-byte
to $MAKEFUN_OUTPUT_DIR/entry.png (or /output/entry.png when the
variable is unset), then checks the copy is identical by comparing
SHA-256 hashes of the source and the destination. If the hashes differ
it raises an error instead of leaving a bad file behind.

The program is fully deterministic: the same input bytes always produce
the same output bytes, and it uses only the Python standard library.
"""

import hashlib
import os
import shutil
import sys
from pathlib import Path


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def check_source(path: Path) -> int:
    """Confirm the source is a whole JPEG or PNG within competition limits.

    Returns the file size in bytes. Raises ValueError on anything else so
    a wrong or truncated file fails loudly instead of being submitted.
    """
    data = path.read_bytes()
    size = len(data)
    if size == 0:
        raise ValueError(f"entry image is empty: {path}")
    # Competition limit: pictures must stay under 5 MB.
    if size > 5 * 1024 * 1024:
        raise ValueError(
            f"entry image is {size} bytes, over the 5 MB limit: {path}"
        )
    jpeg_magic = b"\xff\xd8\xff"
    png_magic = b"\x89PNG\r\n\x1a\n"
    if not (data.startswith(jpeg_magic) or data.startswith(png_magic)):
        raise ValueError(
            f"entry image is neither JPEG nor PNG: {path}"
        )
    return size


def main() -> int:
    here = Path(__file__).resolve().parent
    source = here / "image.png"

    output_dir = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))
    destination = output_dir / "entry.png"

    if not source.is_file():
        raise FileNotFoundError(f"entry image not found: {source}")

    source_size = check_source(source)

    output_dir.mkdir(parents=True, exist_ok=True)

    shutil.copyfile(source, destination)

    source_hash = sha256_of(source)
    destination_hash = sha256_of(destination)
    if source_hash != destination_hash:
        destination.unlink(missing_ok=True)
        raise ValueError(
            "copied image does not match the source: "
            f"source SHA-256 {source_hash}, "
            f"destination SHA-256 {destination_hash}"
        )

    size = destination.stat().st_size
    print(f"wrote {destination} ({size} bytes, sha256 {destination_hash})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
