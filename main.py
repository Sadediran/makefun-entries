#!/usr/bin/env python3
"""Copy the entry image to the competition output directory, verified.

The entry is a single food photograph, image.png, sitting next to this
script: a bowl of tonkotsu ramen with chopsticks lifting a tall, wavy
tangle of glossy noodles high above the bowl, broth droplets falling
back into the creamy broth below. Charred chashu pork, a sheet of nori,
chopped spring onions and a halved soft egg with its yolk running into
the broth sit in a dark bowl on a slate table, with a swirl of red
chili oil across the surface.

This program copies the image byte-for-byte to
$MAKEFUN_OUTPUT_DIR/entry.png (or /output/entry.png when the variable
is unset), then checks the copy is identical by comparing SHA-256
hashes of the source and the destination. If the hashes differ it
raises an error instead of leaving a bad file behind.

The competition limits are enforced before anything is copied: the
image must be at most 1 MiB (1,048,576 bytes) and at most 1024 by 1024
pixels, or the gate scores the entry invalid. The program reads the
dimensions out of the file itself — the PNG IHDR chunk or the JPEG
start-of-frame marker — so a wrong-sized image fails loudly here
instead of reaching the judge.

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
    if len(data) < 24:
        raise ValueError("PNG file too short to hold an IHDR chunk")
    width, height = struct.unpack(">II", data[16:24])
    return width, height


def jpeg_dimensions(data: bytes) -> tuple[int, int]:
    """Walk the JPEG markers to the first start-of-frame segment.

    SOF markers are 0xC0-0xCF except 0xC4, 0xC8 and 0xCC. The scan data
    starts at SOS (0xDA), so reaching it without a SOF means the file
    has no frame header to read.
    """
    pos = 2  # skip the SOI marker
    while pos + 1 < len(data):
        if data[pos] != 0xFF:
            raise ValueError(f"bad JPEG marker at offset {pos}")
        # Skip 0xFF fill bytes, which are legal padding between markers.
        while pos + 1 < len(data) and data[pos + 1] == 0xFF:
            pos += 1
        marker = data[pos + 1]
        if marker == 0xDA:
            raise ValueError("JPEG has no start-of-frame marker before SOS")
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            pos += 2
            continue
        if pos + 4 > len(data):
            raise ValueError("JPEG segment header cut short")
        length = struct.unpack(">H", data[pos + 2 : pos + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                      0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            if pos + 9 > len(data):
                raise ValueError("JPEG SOF segment cut short")
            height, width = struct.unpack(">HH", data[pos + 5 : pos + 9])
            return width, height
        pos += 2 + length
    raise ValueError("ran out of JPEG data before any SOF marker")


def check_source(path: Path) -> tuple[int, int, int]:
    """Confirm the source is a whole JPEG or PNG within competition limits.

    Returns (size in bytes, width, height). Raises ValueError on
    anything else so a wrong or truncated file fails loudly instead of
    being submitted.
    """
    data = path.read_bytes()
    size = len(data)
    if size == 0:
        raise ValueError(f"entry image is empty: {path}")
    if size > MAX_BYTES:
        raise ValueError(
            f"entry image is {size} bytes, over the 1 MiB limit: {path}"
        )
    jpeg_magic = b"\xff\xd8\xff"
    png_magic = b"\x89PNG\r\n\x1a\n"
    if data.startswith(jpeg_magic):
        width, height = jpeg_dimensions(data)
    elif data.startswith(png_magic):
        width, height = png_dimensions(data)
    else:
        raise ValueError(f"entry image is neither JPEG nor PNG: {path}")
    if width > MAX_WIDTH or height > MAX_HEIGHT:
        raise ValueError(
            f"entry image is {width}x{height}, over the 1024x1024 limit"
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
