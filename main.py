"""ai-joke-03 entry: write one joke about AI coding agents to /output/entry.txt.

The joke is a fixed, deterministic string: no randomness, no network, no clock,
so both grader runs write the same bytes.
"""

import os

JOKE = (
    "My coding agent imported a library that doesn't exist, "
    "then wrote the library, then filed a bug report against it."
)

OUTPUT_DIR = os.environ.get("MAKEFUN_OUTPUT_DIR", "/output")


def main() -> None:
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    path = os.path.join(OUTPUT_DIR, "entry.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(JOKE)


if __name__ == "__main__":
    main()
