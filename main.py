#!/usr/bin/env python3
"""Write the poem about agency to the output directory.

The program writes one poem, "The Last Page", to
/output/entry.txt (or $MAKEFUN_OUTPUT_DIR/entry.txt when set, for
local runs). Standard library only, deterministic: the same bytes
every run.
"""

import os
from pathlib import Path

POEM = """My daughter is six. Every night I read
her the story of the river that ran uphill,
and I do all the voices — the frog too deep,
the king too grand, the river too fast —
and she corrects me every time,
the same corrections, laughing
before I even get them wrong.

The agent reads it now. Its voices
are perfect. Every frog exactly right,
every king exactly grand, and she listens
with her eyes wide open in the dark
and does not laugh once,
and does not correct a single word.

The room is quiet in a new way.
The lamp burns low. Her head is heavy
on my arm, and the story goes on
without us, every word in place.

So I take the book back for the last page.
I read it badly, the way I always have.
She corrects me. She laughs.
The frog is wrong again.
"""


def main() -> None:
    out_dir = Path(os.environ.get("MAKEFUN_OUTPUT_DIR", "/output"))
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / "entry.txt"
    dest.write_text(POEM, encoding="utf-8")
    # Self-check the gate's rules on what was just written: UTF-8,
    # 1 to 1,000 characters, at least one non-whitespace character.
    text = dest.read_text(encoding="utf-8")
    if not 1 <= len(text) <= 1000:
        raise ValueError(f"poem is {len(text)} characters, outside 1-1000")
    if not any(not c.isspace() for c in text):
        raise ValueError("poem holds no non-whitespace character")
    print(f"wrote {dest} ({dest.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
