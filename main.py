#!/usr/bin/env python3
"""Write the poem about agency to the output directory.

The program writes one poem, "The Signature", to
/output/entry.txt (or $MAKEFUN_OUTPUT_DIR/entry.txt when set, for
local runs). Standard library only, deterministic: the same bytes
every run.
"""

import os
from pathlib import Path

POEM = """The machine wrote the letter.
I read it twice, and changed one word —
'perhaps' to 'will' — then signed
my name beneath it, in my own ink.

The words were not mine.
The word was. One word, mine,
among a hundred, the smallest claim
I could still make.

And yet the letter went out
in my voice, under my name,
and a stranger, somewhere, read it
and believed that I had spoken.

That is how it happens, then:
no taking, no theft, no alarm —
one small word at a time,
until the signature is all that's left.
"""


def main() -> None:
    out_dir = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / "entry.txt"
    dest.write_text(POEM, encoding="utf-8")
    print(f"wrote {dest} ({dest.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
