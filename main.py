#!/usr/bin/env python3
"""Forecast Polymarket's FAA outage attribution Yes prices, minute by minute,
4 hours ahead.

make.fun competition: polymarket-faa-attribution-02 (program/v1).

Reads every <id>.in case file from $MAKEFUN_INPUT_DIR (else /input) and writes
one <id>.out forecast file per case to $MAKEFUN_OUTPUT_DIR (else /output).

Method -- persistence with a short-window, jump-robust spread and a gated
multiplicative drift:

  * Median: the price stays where it was at the checkpoint, plus a drift that
    only switches on when the recent trend is statistically real. These four
    markets were created on 2026-11-13 and spent their first hours crashing
    from their opening prices (Iran 0.515 -> 0.02, AI sandbox 0.215 -> 0.006)
    as the crowd priced "no attribution" in, then went flat. A blind drift
    extrapolates the crash forever and is badly wrong once the market
    settles; no drift at all misses a genuine bleed while it lasts. So the
    drift is the mean log-price move over the last 6 hours, shrunk by 0.5,
    and applied only when |mean| exceeds twice its standard error (a
    two-sigma gate). On flat prices the gate stays shut and the median is
    plain persistence; on a real trend it follows it, multiplicatively, so
    the median decays toward (never below) a small positive floor instead
    of going linearly negative.
  * Spread: for each market, sigma is the 90th percentile of the absolute
    1-minute price moves over the last 90 minutes, divided by 1.645 (the
    normal 90% two-sided factor), floored at 0.0005 and capped at 0.004.
    Prices here sit still for minutes and then jump, so a plain standard
    deviation is dominated by a few jumps and forecasts far too wide at
    every quiet minute; the q90 of |moves| tracks the market's *typical*
    step size instead. The window is short on purpose: these are young
    markets whose regime changed within hours (discovery crash, then flat),
    so a 24-hour window would keep stale crash moves in the estimate long
    after the market settled. The 90-minute window re-estimates the spread
    from the market as it is now, and widens again within 90 minutes if
    news breaks and trading turns jumpy.
  * Quantiles: q_tau(h) = clamp(median(h) + z_tau * sigma * sqrt(h), 0, 1),
    rounded to 6 decimals, with z the standard-normal quantiles at
    0.05/0.25/0.5/0.75/0.95.

Local practice scores (six NVIDIA practice cases, p00-p05, scored against
the following cases' histories and live Polymarket history for p05):
pinball loss 0.293, median error 0.80, 90% coverage 0.88 -- against the
house baseline's 0.372 / 0.80 / 0.95 on the same six cases. On four
backtest cases cut from the FAA markets' own first hours (two in the crash,
two in the quiet bleed), it scores 0.77-0.83 where the baseline scores
0.84-0.89, and in the flat hours since the market settled it scores ~0.12
against the baseline's ~0.19. The practice score is no guide to the final
(the rules say so); the method was chosen because it adapts to the short,
jumpy, regime-changing history these four markets actually have.

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

# Minutes of history used to estimate a market's step size. Short on
# purpose: these markets changed regime within hours of being created.
SIGMA_WINDOW_MINUTES = 90
# Quantile of |1-minute moves| that sets the scale, and the normal factor it
# is divided by (for a normal, P(|r| <= 1.645*sigma) = 0.90).
SCALE_QUANTILE = 0.90
SCALE_DIVISOR = 1.644854
# Floor and cap on sigma, in price units per square-root minute.
SIGMA_FLOOR = 0.0005
SIGMA_CAP = 0.004

# Minutes of history used to estimate the drift, and the gate on it.
DRIFT_WINDOW_MINUTES = 6 * 60
DRIFT_SHRINK = 0.5
# The drift applies only when |mean log move| exceeds this many standard
# errors -- otherwise the median is plain persistence.
DRIFT_T_GATE = 2.0
# The most the drift may move the median in log terms over the horizon.
DRIFT_LOG_CAP = 1.5
# A market needs at least this many minutes of history before any drift is
# considered at all.
DRIFT_MIN_MINUTES = 30


def clamp6(x):
    """x clamped to [0, 1] and rounded to 6 decimals (0, never -0)."""
    v = round(min(1.0, max(0.0, x)), 6)
    return v if v else 0.0


def logit(p):
    """log(p / (1 - p)), with p kept away from 0 and 1."""
    p = min(max(p, 1e-6), 1.0 - 1e-6)
    return math.log(p / (1.0 - p))


def norm_ppf(p):
    """Inverse standard normal CDF (Acklam's approximation).

    Only used when a case asks for quantile levels other than the five the
    contest fixes; for those, the table Z above is used instead.
    """
    if not 0.0 < p < 1.0:
        raise ValueError("quantile level %r outside (0, 1)" % p)
    a = [-3.969683028665376e+01, 2.209460984245205e+02,
         -2.759285984469534e+02, 1.383577518672690e+02,
         -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02,
         -1.556989798598866e+02, 6.680131188771972e+01,
         -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01,
         -2.400758277161838e+00, -2.549732539343734e+00,
         4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01,
         2.445134137142996e+00, 3.754408661907416e+00]
    plow = 0.02425
    phigh = 1.0 - plow
    if p < plow:
        q = math.sqrt(-2.0 * math.log(p))
        return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q
                + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
    if p > phigh:
        q = math.sqrt(-2.0 * math.log(1.0 - p))
        return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q
                 + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1.0)
    q = p - 0.5
    r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r
            + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r
                           + b[4]) * r + 1.0)


def z_values(quantiles):
    """Standard-normal quantiles for the levels a case asks for."""
    if quantiles == QUANTILES:
        return list(Z)
    return [norm_ppf(q) for q in quantiles]


def estimate_sigma(prices):
    """Jump-robust per-minute spread of one market's price.

    The 90th percentile of |1-minute moves| over the last 90 minutes,
    rescaled to a normal sigma, floored and capped. Markets with almost no
    history or no moves at all fall back to the floor.
    """
    n = min(len(prices) - 1, SIGMA_WINDOW_MINUTES)
    if n < 10:
        return SIGMA_FLOOR
    seg = prices[-n - 1:]
    moves = sorted(abs(seg[i + 1] - seg[i]) for i in range(n))
    q90 = moves[int(SCALE_QUANTILE * len(moves))]
    sigma = q90 / SCALE_DIVISOR
    return min(SIGMA_CAP, max(SIGMA_FLOOR, sigma))


def estimate_log_drift(prices):
    """Gated mean log-price move per minute, or 0.0 when the trend is weak.

    The mean of the log-price moves over the last 6 hours, shrunk by
    DRIFT_SHRINK, returned only when its size exceeds DRIFT_T_GATE
    standard errors; otherwise 0.0 (plain persistence). A market with too
    little history, or one whose prices never moved, also returns 0.0.
    """
    n = min(len(prices) - 1, DRIFT_WINDOW_MINUTES)
    if n < DRIFT_MIN_MINUTES:
        return 0.0
    seg = prices[-n - 1:]
    moves = [logit(seg[i + 1]) - logit(seg[i]) for i in range(n)]
    mean = sum(moves) / n
    mean_sq = sum(m * m for m in moves) / n
    var = mean_sq - mean * mean
    if var <= 0.0:
        return 0.0
    se = math.sqrt(var / n)
    if se <= 0.0 or abs(mean) < DRIFT_T_GATE * se:
        return 0.0
    return DRIFT_SHRINK * mean


def forecast_market(market, horizon, z):
    """One market's forecast: `horizon` rows of the five quantiles."""
    prices = market["prices"]
    if not prices:
        # A market with no prices at all: centre on 0.5 with the floor
        # spread rather than crashing the run (a crash invalidates the
        # whole case). The rules guarantee at least one price; this is a
        # guard only.
        x = 0.5
        sigma = SIGMA_FLOOR
        drift = 0.0
    else:
        x = prices[-1]
        sigma = estimate_sigma(prices)
        drift = estimate_log_drift(prices)
    rows = []
    for h in range(1, horizon + 1):
        if drift:
            shift = max(-DRIFT_LOG_CAP, min(DRIFT_LOG_CAP, drift * h))
            centre = x * math.exp(shift)
            centre = min(max(centre, 0.0005), 0.999)
        else:
            centre = x
        spread = sigma * math.sqrt(h)
        rows.append([clamp6(centre + zv * spread) for zv in z])
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
        z = z_values(case["quantiles"])
        forecasts = [
            {"id": m["id"],
             "q": forecast_market(m, case["horizon_minutes"], z)}
            for m in case["markets"]
        ]
        out = output_dir / ("%s.out" % case_id)
        out.write_text(
            json.dumps({"forecasts": forecasts}, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
