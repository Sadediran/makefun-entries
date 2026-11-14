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

- **Median: persistence, plus a gated multiplicative drift.** The price
  stays where it was at the checkpoint, unless the recent trend is
  statistically real: the mean log-price move over the last 6 hours,
  shrunk by 0.5, applied only when it exceeds twice its standard error.
  These four markets were created on 2026-11-13 and spent their first hours
  crashing from their opening prices (Iran 0.515 → 0.02, AI sandbox
  0.215 → 0.006) as the crowd priced "no attribution" in, then went flat.
  A blind drift extrapolates the crash forever; no drift misses a genuine
  bleed while it lasts. The gate keeps persistence on flat prices and
  follows a real trend multiplicatively, so the median decays toward (never
  below) a small positive floor.
- **Spread: per-market, jump-robust, short-window.** For each market, sigma
  is the 90th percentile of absolute 1-minute price moves over the last 90
  minutes, divided by 1.645, floored at 0.0005 and capped at 0.004. Prices
  here sit still for minutes and then jump, so the plain standard deviation
  is dominated by a few jumps and forecasts far too wide at every quiet
  minute; the q90 of |moves| tracks the market's *typical* step size. The
  90-minute window is short on purpose: these are young markets whose regime
  changed within hours, so a 24-hour window would keep stale crash moves in
  the estimate long after the market settled.
- **Quantiles:** `q_tau(h) = clamp(median(h) + z_tau * sigma * sqrt(h), 0, 1)`,
  rounded to 6 decimals, with `z` the standard-normal quantiles.

## Local validation

Scored on the six practice cases (p00–p05, NVIDIA markets) against the
following cases' histories and live Polymarket history for p05:

| | pinball loss | median error | 90% coverage |
|---|---|---|---|
| This entry | **0.293** | 0.80 | 0.88 |
| House baseline (same 6 cases) | 0.372 | 0.80 | 0.95 |

On four backtest cases cut from the FAA markets' own first hours (two in
the opening crash, two in the quiet bleed that followed), it scores
0.77–0.83 where the baseline scores 0.84–0.89; in the flat hours since the
markets settled it scores ~0.12 against the baseline's ~0.19. The practice
score is no guide to the final (the rules say so); the method was chosen
because it adapts to the short, jumpy, regime-changing history these four
markets actually have.

Output is byte-identical across repeated runs, and every output file
validates against the required schema (one row per market, 240 rows, five
non-decreasing quantiles in [0, 1] per row, under 1 MiB). A market with no
prices at all (which the rules say cannot happen) falls back to a 0.5 median
with the floor spread rather than crashing the run.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out python3 main.py
```
