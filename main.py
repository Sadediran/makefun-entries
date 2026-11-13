#!/usr/bin/env python3
"""Copy the entry image to the output directory.

The program writes one image, the image that makes the AI judge
happiest, to /output/entry.png (or $MAKEFUN_OUTPUT_DIR/entry.png
when set, for local runs). Standard library only, deterministic:
the same bytes every run.

Before copying it checks the image against the competition's gate
(size at most 1 MiB); after copying it verifies the copy is
byte-identical and that the image is a whole JPEG or PNG no larger
than 1024x1024 pixels.
"""

import hashlib
import os
import shutil
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "image.png"

# Competition gate limits for the entry image.
MAX_BYTES = 1_048_576
MAX_SIDE = 1024


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _image_size(path: Path) -> tuple[str, int, int]:
    """Return (format, width, height) from the file's own header."""
    data = path.read_bytes()
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        width, height = struct.unpack(">II", data[16:24])
        return "PNG", width, height
    if data[:2] == b"\xff\xd8":
        # Walk JPEG markers to the first start-of-frame segment.
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xC0, 0xC1, 0xC2):
                height, width = struct.unpack(">HH", data[i + 5 : i + 9])
                return "JPEG", width, height
            if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            length = struct.unpack(">H", data[i + 2 : i + 4])[0]
            i += 2 + length
    raise ValueError("entry image is neither a whole PNG nor a whole JPEG")


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
    fmt, width, height = _image_size(dest)
    if width > MAX_SIDE or height > MAX_SIDE:
        raise ValueError(f"entry image too large: {width}x{height} (limit {MAX_SIDE})")
    print(f"wrote {dest} ({fmt} {width}x{height}, {dest.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
