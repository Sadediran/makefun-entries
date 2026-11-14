#!/usr/bin/env python3
"""Copy the entry image to the competition output directory, verified.

The entry is a single food photograph, image.png, sitting next to this
script: a bowl of tonkotsu ramen, chopsticks lifting a tall glossy
noodle pull high above the bowl, steam curling around the noodles, a
soft egg with its yolk dripping down through the noodles, charred
chashu, nori and a swirl of chili oil on a dark wooden table. This
program copies it byte-for-byte to $MAKEFUN_OUTPUT_DIR/entry.png (or
/output/entry.png when the variable is unset), then checks the copy is
identical by comparing SHA-256 hashes of the source and the
destination. If the hashes differ it raises an error instead of
leaving a bad file behind.

The competition's limits, from the kit's RULES.txt, are enforced here
before anything is copied: the file must be a whole PNG or JPEG, at
most 1 MiB (1,048,576 bytes) and at most 1024 by 1024 pixels. A file
over either limit is refused loudly, because the sealed gate scores
such an entry Valid 0 and it takes no prize.

The program is fully deterministic: the same input bytes always produce
the same output bytes, and it uses only the Python standard library.
"""

import hashlib
import os
import shutil
import struct
import sys
from pathlib import Path

MAX_BYTES = 1_048_576
MAX_WIDTH = 1024
MAX_HEIGHT = 1024


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def png_dimensions(data: bytes) -> tuple[int, int]:
    """Read width and height from a PNG's IHDR chunk (bytes 16-24)."""
    if len(data) < 24 or data[12:16] != b"IHDR":
        raise ValueError("PNG is missing its IHDR chunk")
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def jpeg_dimensions(data: bytes) -> tuple[int, int]:
    """Read width and height from a JPEG's first frame header (SOF).

    Walks the marker segments from the start of file, skipping each
    segment by its own length, until a start-of-frame marker (SOF0,
    SOF1, SOF2 or a sibling) is found; its height and width follow its
    length and precision bytes. Standalone markers carry no length and
    are stepped over two bytes at a time.
    """
    pos = 2  # skip the SOI marker
    while pos + 1 < len(data):
        if data[pos] != 0xFF:
            raise ValueError("bad JPEG marker")
        marker = data[pos + 1]
        while marker == 0xFF:  # fill bytes before the marker
            pos += 1
            marker = data[pos + 1]
        if marker == 0x01 or marker == 0xD8 or 0xD0 <= marker <= 0xD7:
            pos += 2
            continue
        if marker == 0xD9:
            raise ValueError("JPEG ends before any frame header")
        if marker == 0xDA:
            raise ValueError("JPEG scan data before any frame header")
        if pos + 4 > len(data):
            raise ValueError("truncated JPEG segment")
        length = struct.unpack(">H", data[pos + 2:pos + 4])[0]
        if length < 2 or pos + 2 + length > len(data):
            raise ValueError("truncated JPEG segment")
        if marker in (
            0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
            0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF,
        ):
            height, width = struct.unpack(">HH", data[pos + 5:pos + 9])
            return width, height
        pos += 2 + length
    raise ValueError("no JPEG frame header found")


def image_dimensions(data: bytes) -> tuple[int, int]:
    """Return (width, height) for a PNG or JPEG, told apart by magic."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return png_dimensions(data)
    if data.startswith(b"\xff\xd8\xff"):
        return jpeg_dimensions(data)
    raise ValueError("entry image is neither JPEG nor PNG")


def check_source(path: Path) -> tuple[int, int, int]:
    """Confirm the source is a whole image within the competition limits.

    Returns (size in bytes, width, height). Raises ValueError on
    anything else so a wrong, truncated or oversized file fails loudly
    instead of being submitted.
    """
    data = path.read_bytes()
    size = len(data)
    if size == 0:
        raise ValueError(f"entry image is empty: {path}")
    if size > MAX_BYTES:
        raise ValueError(
            f"entry image is {size} bytes, over the 1 MiB limit: {path}"
        )
    width, height = image_dimensions(data)
    if width > MAX_WIDTH or height > MAX_HEIGHT:
        raise ValueError(
            f"entry image is {width}x{height}, over the "
            f"{MAX_WIDTH}x{MAX_HEIGHT} limit: {path}"
        )
    return size, width, height


def main() -> int:
    here = Path(__file__).resolve().parent
    source = here / "image.png"

    output_dir = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))
    destination = output_dir / "entry.png"

    if not source.is_file():
        raise FileNotFoundError(f"entry image not found: {source}")

    source_size, width, height = check_source(source)

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
    print(
        f"wrote {destination} ({size} bytes, {width}x{height}, "
        f"sha256 {destination_hash})"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
