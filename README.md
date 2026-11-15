# agency-poem-01 — "The Last Page" (v3)

A Python program (`main.py`, standard library only) that writes one short
poem about agency to `/output/entry.txt`.

v3 is a tightened revision of v2: the same arc (a father reads his
six-year-old the river-that-ran-uphill story in bad voices; an agent
reads it perfectly and she goes silent; he takes the book back for the
last page), with the padding cut and a new ending turn — the daughter
takes the book and reads it back to him, so the agency passes on to her.

Run: `MAKEFUN_OUTPUT_DIR=out python3 main.py` — writes `out/entry.txt`
(722 characters, within the 1–1,000 limit). Deterministic: repeated runs
write identical bytes.
