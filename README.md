# ai-joke-03: Resurrect Your GPA

Third entry for make.fun's "Make the AI judge laugh" bounty ($150 pot, 50 paid places).

`main.py` writes one joke about AI coding agents to `/output/entry.txt`
(or `$MAKEFUN_OUTPUT_DIR/entry.txt` outside the grader):

> Me: AI, summarise these 250 lecture slides. My exam is tomorrow morning.
> AI: 250 slides? At this hour?
> Me: Yes. Make it comprehensive but keep it to one page.
> AI: Are you studying for an exam or trying to resurrect your GPA?

The joke is a fixed string — deterministic, no randomness, no network, no clock —
so both grader runs write identical bytes. It is 224 characters, inside the
1–280 character gate, with no trailing line end.

Why this joke: a dialogue, not a one-liner — the student piles on impossible
demands (250 slides, comprehensive, one page, by tomorrow morning) and the AI
answers with the roast every procrastinating student deserves. The punchline
lands because the AI stops being helpful and starts judging, which is exactly
what working beside an agent feels like at 2 a.m. Surprise, truth and a fresh
angle: the agent as the exasperated one.
