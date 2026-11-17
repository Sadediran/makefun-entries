# Capitulation-bounce + regime-gated momentum bot

A long-only cbBTC/USDC trading bot for make.fun's `agent-fun/bars-replay/v1`
replay (`main.ts`, Node 22, standard library plus the vendored kit SDK shim
in `vendor/`). It speaks NDJSON on stdin/stdout, decides once per 1-minute
bar, and uses bigint integer math throughout, so two runs on the same bars
produce byte-identical orders.

## Why this shape

The dev window falls ~5% in its first 7 hours and then ranges for 17 hours.
Every shipped baseline loses on it (buy-and-hold −52.59, ema-cross −109.38,
rsi-bollinger −65.83 USDC): chasing 1-minute moves pays ~26 bps a round trip
and the hourly structure mean-reverts. So the bot trades rarely, on two
high-conviction setups, and rides the move with a wide trailing stop:

1. **Capitulation bounce** — 240-minute return ≤ −2.5% *and* 15-minute return
   ≥ +0.5%. The bounce confirms the turn instead of catching the falling
   knife; buying every dip or lower Bollinger band lost −65 to −127 in
   screening.
2. **Regime-gated momentum** — 60-minute return ≥ +0.5% *and* 240-minute
   return ≥ 0. Ungated momentum lost ~22 on the dev window; the gate keeps
   the bot out while the 4-hour trend is down.

**Exits** (both entries): take profit +2.0% over cost, stop loss −0.8% under
cost, 1.5% trailing stop below the peak position value at a bar close. The
wide trail matters — the winning dev trade rides +2.2% from the bottom, and
tight exits chop it off near breakeven.

**Risk controls**: no new entries in the last 60 bars; a 30-bar cooldown
after any sell so an exit is not chased straight back into the same move;
at most one open position; buys spend all cash; sells empty the position;
every order caps slippage at 100 bps from the close it was decided on.

## Local grade (dev window)

```
net PnL   +7.873 USDC (return +0.79%)
trading   4 trades, win rate 0.50, max drawdown 1.19%
fees      1.62 USDC; at 2x fees net PnL +6.26 USDC
guardrails met; L1 regrade reproduced byte for byte
```

The bounce-only variant scores +18.22 but never trades in a rising market;
the gated-momentum leg is kept because it is what lets the bot trade at all
when the race window trends up.

## Layout

- `main.ts` — the bot (the entrypoint)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim
- `LICENSE` — MIT
