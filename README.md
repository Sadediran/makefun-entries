# NVIDIA CEO price forecaster — make.fun bounty

Forecasts the Yes price of every market of Polymarket's "Next CEO of NVIDIA?"
event, minute by minute, 4 hours ahead, as five quantiles (0.05 / 0.25 / 0.5 /
0.75 / 0.95) per minute. Entry for make.fun's
`polymarket-nvidia-ceo-forecast-01` bounty ($250 USDC).

## How it works

`main.py` (Python 3.13, standard library only, no network, fully
deterministic) reads each case's `*.in` file from `$MAKEFUN_INPUT_DIR`
(default `/input`) and writes one `*.out` forecast per case to
`$MAKEFUN_OUTPUT_DIR` (default `/output`).

- **Median: persistence.** The price stays where it was at the checkpoint.
  On the practice cases, a shrunk drift and a mean-reversion term both made
  the median worse, so neither is used.
- **Spread: per-market and jump-robust.** For each market, sigma is the 90th
  percentile of absolute 1-minute price moves over the last 24 hours,
  divided by 1.645, floored at 0.0003 and capped at 0.004. Prices here sit
  still for minutes and then jump, so the plain standard deviation of
  returns is dominated by a few jumps and forecasts far too wide at every
  quiet minute; the q90 of |moves| tracks the market's typical step size.
- **Quantiles:** `q_tau(h) = clamp(x + z_tau * sigma * sqrt(h), 0, 1)`,
  rounded to 6 decimals, with `z` the standard-normal quantiles.

## Local validation

Scored on practice cases p00–p04 against the following cases' histories
(p05's answers are not in the kit):

| | pinball loss | median error | 90% coverage |
|---|---|---|---|
| This entry | **0.312142** | 0.879497 | 0.838 |
| House baseline (same 5 cases) | 0.392518 | 0.879497 | 0.938 |

The improvement is consistent in every one of the five cases. Output is
byte-identical across repeated runs, and every output file validates against
the required schema (one row per market, 240 rows, five non-decreasing
quantiles in [0, 1] per row, under 1 MiB).

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out python3 main.py
```
