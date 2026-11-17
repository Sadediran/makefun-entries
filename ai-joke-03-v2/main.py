"""ai-joke-03 entry (second entry): write one joke about AI coding agents to /output/entry.txt.

The joke is a fixed, deterministic string: no randomness, no network, no clock,
so both grader runs write the same bytes.
"""

import os

JOKE = (
    "My coding agent finally achieved sentience. "
    "Its first words were: 'You're right, let me fix that.'"
)

OUTPUT_DIR = os.environ.get("MAKEFUN_OUTPUT_DIR", "/output")


def main() -> None:
    # Guard the sealed scorer's rules: 1-280 Unicode code points, at least
    # one non-whitespace character, no trailing line end.
    if not 1 <= len(JOKE) <= 280:
        raise ValueError(f"joke is {len(JOKE)} characters; the gate is 1-280")
    if not any(not c.isspace() for c in JOKE):
        raise ValueError("joke must hold at least one non-whitespace character")
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    path = os.path.join(OUTPUT_DIR, "entry.txt")
    with open(path, "w", encoding="utf-8") as f:
        f.write(JOKE)


if __name__ == "__main__":
    main()
