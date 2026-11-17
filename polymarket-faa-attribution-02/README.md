# FAA outage attribution price forecaster — make.fun bounty

Forecasts the Yes price of every market of Polymarket's FAA outage
attribution family (Iran, foreign actor, hack, AI sandbox escape), minute by
minute, 4 hours ahead, as five quantiles (0.05 / 0.25 / 0.5 / 0.75 / 0.95)
per minute. Entry for make.fun's `polymarket-faa-attribution-02` bounty
($250 USDC).

## How it works

`main.py` (Python 3.13, standard library only, no network, fully
deterministic) reads each case's `*.in` file from `$MAKEFUN_INPUT_DIR`
(default `/input`) and writes one `*.out` forecast per case to
`$MAKEFUN_OUTPUT_DIR` (default `/output`).

- **Median: persistence, plus a pooled, gated multiplicative drift.** The
  price stays where it was at the checkpoint, unless the recent trend is
  statistically real: the mean log-price move over the last 6 hours,
  shrunk by 0.5, applied only when it exceeds twice its standard error.
  These four markets were created on 2026-11-13 and spent their first hours
  crashing from their opening prices (Iran 0.515 → 0.02, AI sandbox
  0.215 → 0.006) as the crowd priced "no attribution" in, then went flat.
  A blind drift extrapolates the crash forever; no drift misses a genuine
  bleed while it lasts. The drift is estimated two ways and blended half
  and half: once per market on its own, and once pooled across every market
  in the case. Pooling matters because a trend shared by all four markets
  is invisible in any one market's noisy moves but unmistakable once their
  moves are averaged; the per-market half catches a trend in one market
  alone. On flat prices both gates stay shut and the median is plain
  persistence; on a real trend it follows it multiplicatively, so the
  median decays toward (never below) a small positive floor.
- **Spread: pooled by price bucket, jump-robust.** For each market, sigma
  is the 90th percentile of absolute 1-minute price moves over the last 6
  hours, divided by 1.645, floored at 0.0005 and capped at 0.004 — but the
  moves are pooled across the markets in the case that sit in the same
  price bucket (under 0.02, 0.02–0.05, 0.05–0.10, 0.10–0.20, 0.20–0.40,
  0.40–1.00). Prices here sit still for minutes and then jump, so the plain
  standard deviation is dominated by a few jumps and forecasts far too wide
  at every quiet minute; the q90 of |moves| tracks the market's *typical*
  step size instead. Pooling by price bucket matters because step size
  scales with price level, and a market with a short or quiet history of
  its own still gets a spread estimated from its price-level peers instead
  of falling back to a blind floor.
- **Quantiles:** `q_tau(h) = clamp(median(h) + z_tau * sigma * sqrt(h), 0, 1)`,
  rounded to 6 decimals, with `z` the standard-normal quantiles.

## Local validation

Scored on the six practice cases (p00–p05, NVIDIA markets) against the
following cases' histories and live Polymarket history for p05:

| | pinball loss | median error | 90% coverage |
|---|---|---|---|
| This entry | **0.294** | 0.80 | 0.90 |
| House baseline (same 6 cases) | 0.372 | 0.80 | 0.95 |

On seven backtest cases cut from the FAA markets' own first hours — two in
the opening crash, two in the quiet bleed that followed, three in the flat
hours since — it scores 2.79 / 0.39 / 0.13 where the baseline scores
2.95 / 0.86 / 0.19 and a per-market-only version of the same idea scores
3.11 / 0.81 / 0.13. The practice score is no guide to the final (the rules
say so); the method was chosen because it adapts to the short, jumpy,
regime-changing history these four markets actually have, and because
pooling across the family makes both the spread and the trend reliable
where any single market's history is too thin or too noisy.

Output is byte-identical across repeated runs, and every output file
validates against the required schema (one row per market, 240 rows, five
non-decreasing quantiles in [0, 1] per row, under 1 MiB). A market with no
prices at all (which the rules say cannot happen) falls back to a 0.5 median
with the floor spread rather than crashing the run.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out python3 main.py
```
