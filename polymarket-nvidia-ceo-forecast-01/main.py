#!/usr/bin/env python3
"""Forecast Polymarket's next NVIDIA CEO Yes prices, minute by minute, 4 hours ahead.

make.fun competition: polymarket-nvidia-ceo-forecast-01 (program/v1).

Reads every <id>.in case file from $MAKEFUN_INPUT_DIR (else /input) and writes
one <id>.out forecast file per case to $MAKEFUN_OUTPUT_DIR (else /output).

Method -- persistence with a per-market, jump-robust spread:
  * Median: the price stays where it was at the checkpoint. Polymarket prices
    are close to a martingale on this horizon: on the practice cases a shrunk
    drift and a mean-reversion term both made the median worse, so neither is
    used.
  * Spread: for each market, sigma is the 90th percentile of the absolute
    1-minute price moves over the last 24 hours, divided by 1.645 (the normal
    90% two-sided factor), floored at 0.0003 and capped at 0.004. The plain
    standard deviation of returns is useless here -- prices sit still for
    minutes and then jump, so a std is dominated by a few jumps and the
    forecast ends up far too wide at every quiet minute. The q90 of |moves|
    tracks the market's *typical* step size instead.
  * Quantiles: q_tau(h) = clamp(x + z_tau * sigma * sqrt(h), 0, 1), rounded
    to 6 decimals, with z the standard-normal quantiles at
    0.05/0.25/0.5/0.75/0.95.

Local practice score (p00-p04, scored against the following cases' histories;
p05's answers are not in the kit): pinball loss 0.312142, median error
0.879497, 90% coverage 0.838462 -- against the house baseline's 0.392518 on
the same five cases (official baseline practice loss over all six: 0.363589).

Deterministic: standard library only, no network, no randomness, no clock.
The same input always produces the same bytes.
"""

import json
import math
import os
from pathlib import Path

INPUT_DIR = os.environ.get("MAKEFUN_INPUT_DIR", "/input")
OUTPUT_DIR = os.environ.get("MAKEFUN_OUTPUT_DIR", "/output")

# The quantile levels the contest scores, in the order each row lists them.
QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95]
# The standard normal's quantile at each level, to 6 decimals.
Z = [-1.644854, -0.67449, 0.0, 0.67449, 1.644854]

# Minutes of history used to estimate a market's step size.
WINDOW_MINUTES = 24 * 60
# Quantile of |1-minute moves| that sets the scale, and the normal factor it
# is divided by (for a normal, P(|r| <= 1.645*sigma) = 0.90).
SCALE_QUANTILE = 0.90
SCALE_DIVISOR = 1.644854
# Floor and cap on sigma, in price units per square-root minute.
SIGMA_FLOOR = 0.0003
SIGMA_CAP = 0.004


def clamp6(x):
    """x clamped to [0, 1] and rounded to 6 decimals (0, never -0)."""
    v = round(min(1.0, max(0.0, x)), 6)
    return v if v else 0.0


def estimate_sigma(prices):
    """Jump-robust per-minute spread of one market's price.

    The 90th percentile of |1-minute moves| over the last 24 hours, rescaled
    to a normal sigma, floored and capped. Markets with almost no history or
    no moves at all fall back to the floor.
    """
    n = min(len(prices) - 1, WINDOW_MINUTES)
    if n < 10:
        return SIGMA_FLOOR
    seg = prices[-n - 1:]
    moves = sorted(abs(seg[i + 1] - seg[i]) for i in range(n))
    q90 = moves[int(SCALE_QUANTILE * len(moves))]
    sigma = q90 / SCALE_DIVISOR
    return min(SIGMA_CAP, max(SIGMA_FLOOR, sigma))


def forecast_market(market, horizon):
    """One market's forecast: `horizon` rows of the five quantiles."""
    prices = market["prices"]
    if not prices:
        raise ValueError("market %s has no prices" % market["id"])
    x = prices[-1]
    sigma = estimate_sigma(prices)
    rows = []
    for h in range(1, horizon + 1):
        spread = sigma * math.sqrt(h)
        rows.append([clamp6(x + z * spread) for z in Z])
    return rows


def main():
    input_dir = Path(INPUT_DIR)
    output_dir = Path(OUTPUT_DIR)
    output_dir.mkdir(parents=True, exist_ok=True)
    # Every case file, in name order, so two runs write the same bytes.
    inputs = sorted(p for p in input_dir.iterdir() if p.name.endswith(".in"))
    for path in inputs:
        case_id = path.name[: -len(".in")]
        case = json.loads(path.read_text(encoding="utf-8"))
        if case["quantiles"] != QUANTILES:
            raise ValueError(
                "%s asks for quantiles %r, not %r"
                % (path.name, case["quantiles"], QUANTILES)
            )
        forecasts = [
            {"id": m["id"], "q": forecast_market(m, case["horizon_minutes"])}
            for m in case["markets"]
        ]
        out = output_dir / ("%s.out" % case_id)
        out.write_text(
            json.dumps({"forecasts": forecasts}, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
