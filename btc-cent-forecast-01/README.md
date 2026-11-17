# BTC cent forecast — walk-forward ridge blend

Entry for make.fun's `btc-cent-forecast-01`: forecast Bitcoin's US-dollar
price 240 minutes (4 hours) after each checkpoint, from the 72 hours of
1-minute closes up to it, for the lowest mean absolute error in cents.

## Method

`main.py` (Python 3.13, standard library only, no network) blends two
signals, both computed from the case's own prices and nothing else:

1. **Walk-forward ridge regression.** Inside the case, every 15 minutes
   from hour 24 onward we build a training point: seven features at that
   minute (non-overlapping window returns, deviation from the 6-hour and
   24-hour rolling medians, recent volatility) and the realised 240-minute
   log return that followed. The ridge (lambda 50, standardised features)
   is fitted on those in-case points only, then applied at the checkpoint,
   shrunk 40% toward zero.
2. **Mean reversion.** −0.2 times the 24-hour log return. Across the
   practice history the 240-minute forward return is negatively correlated
   with the past day's move, so a day's fall is partly retraced.

The blend is 70% ridge + 30% mean reversion, in log space, applied to the
checkpoint close. A loose volatility-scaled clip guards against wild
extrapolation, and any failure falls back to persistence (the checkpoint
close) so the case stays valid.

## Validation (all strictly causal, same test points as the baseline)

| Test | This entry | Persistence | Improvement |
| --- | --- | --- | --- |
| Walk-forward, late checkpoints (480 pts) | 29,706 ¢ | 39,820 ¢ | +25.4% |
| Deployment-style pseudo-checkpoints (30 pts) | 23,779 ¢ | 29,438 ¢ | +19.2% |
| Practice cases p00–p04 (reconstructed answers) | 36,566 ¢ | 47,055 ¢ | +22.3% |

Richer feature sets, recency weighting, median adjustment and momentum
variants were all tested and cut because they did not help out of sample.

## Running locally

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out python3 main.py
```

Runs in ~0.1 s per case, deterministic (byte-identical across runs).

## Licence

MIT.
