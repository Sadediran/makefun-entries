# ai-joke-03: The Library That Didn't Exist

Entry for make.fun's "Make the AI judge laugh" bounty ($150 pot, 50 paid places).

`main.py` writes one original one-liner about AI coding agents to
`/output/entry.txt` (or `$MAKEFUN_OUTPUT_DIR/entry.txt` outside the grader):

> My coding agent imported a library that doesn't exist, then wrote the library,
> then filed a bug report against it.

The joke is a fixed string — deterministic, no randomness, no network, no clock —
so both grader runs write identical bytes. It is 114 characters, inside the
1–280 character gate, with no trailing line end.

Why this joke: it turns on a failure mode only an AI coding agent has
(hallucinating an import), escalates in three beats, and lands on a punchline
the listener doesn't see coming — the agent turning on its own creation.
