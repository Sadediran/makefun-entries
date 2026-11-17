# Armed deep-dip bounce + regime-gated momentum bot

A long-only cbBTC/USDC trading bot for make.fun's `agent-fun/bars-replay/v1`
replay (`main.ts`, Node 22, standard library plus the vendored kit SDK shim
in `vendor/`). It speaks NDJSON on stdin/stdout, decides once per 1-minute
bar, and uses bigint integer math throughout, so two runs on the same bars
produce byte-identical orders.

## Why this shape

The dev window falls 7.9% peak-to-trough over 17 hours and then snaps back
+5.5% in a V; the previous race's dev window grinds down 5% over 7 hours
and recovers only +3%. Every shipped baseline loses on both. The previous
race's whole top 10 were deep-dip buyers with 2 trades each, and this
race's dev leaders are the same family (#1 +$46.50, 2 trades). So the bot
trades rarely, on one high-conviction setup, and rides the move:

1. **Armed deep-dip bounce** — the bot arms only when the 240-minute
   return falls to −4.0% or worse (a real capitulation, not a drift), stays
   armed for 30 bars, and buys only while armed AND the 15-minute return
   is +0.5% or better. The arming is what keeps it out of the mid-decline
   dead-cat bounces: on both dev windows the fake bounces sit at 240m
   −2.8% to −3.9% and never arm, while the real bottoms arm (240m −4.25%
   and −3.96%) and then confirm. A plain "240m ≤ −3% and 15m ≥ +0.3%"
   rule buys the fakes and loses ~$11 a time; the armed rule takes no
   losing trade on either window.
2. **Regime-gated momentum** (uptrend insurance) — if the race window
   trends up with no −4% dip, the bounce leg never trades, so a second leg
   buys when the 60-minute return is +1.5% or better AND the 240-minute
   return is +1.5% or better AND the 15-minute return is +0.3% or better,
   blocked for 240 bars after any sell so it never chases the top of a
   bounce just exited. It fired on neither dev window (cost $0 there).

**Exits** (both entries): take profit +3.5% over cost, stop loss −0.8%
under cost, 1.2% trailing stop below the peak position value at a bar
close. +3.5% banks most of a strong V and still fires on a moderate one;
the trailing stop is what exits a weaker V near its peak. A +2% take
profit caps the strong V at ~+$18; a +4.5% one never fires on the weak V.

**Risk controls**: no new entries in the last 60 bars; a 30-bar cooldown
after any sell; at most one open position; buys spend all cash; sells
empty the position; every order caps slippage at 300 bps from the close
it was decided on.

## Local grades (dev windows, grade-local --driver process)

New race dev window (`btc-race-24h-20261115-0828`):

```
net PnL   +39.095471 USDC (return +3.91%)
trading   2 trades, win rate 1.00, max drawdown 0.52%
fees      0.815805 USDC; at 2x fees net PnL +38.264918 USDC
guardrails met; L1 regrade reproduced byte for byte
```

Previous race dev window (`btc-race-24h-20261113-2314`, second sample,
same bot, no retuning):

```
net PnL   +6.600114 USDC (return +0.66%)
trading   2 trades, win rate 1.00, max drawdown 1.42%
fees      0.802802 USDC; at 2x fees net PnL +5.795296 USDC
guardrails met; L1 regrade reproduced byte for byte
```

One round trip on each window, no losing trade on either. The dev board's
current leader is +$46.50 (2 trades); this entry's +$39.10 would sit just
under it — the gap is one entry bar: the leader caught the trough a few
bars earlier than the armed +0.5% confirmation allows, and that earliness
is exactly what buys the fake bounces on the other window, so it is not
chased.

## Risks

- The race window is unseen: if its dip is shallower than −4% over 240
  minutes the bounce leg never arms and the bot leans on the momentum leg
  alone; if it crashes with no recovery, the stop loss caps the loss near
  −0.8% plus fees per entry.
- The dev score (+$39.10) is close to the #2 dev entry's published
  +$39.10; if that entry's action log is byte-identical to this bot's
  (same buy/sell bars), this entry keeps its rank but takes no prize
  under the identical-behaviour rule. The triggers differ in structure
  (arming + momentum leg + different exits), but the fills on this window
  may coincide — unverifiable from public data.

## Layout

- `main.ts` — the bot (the entrypoint)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's SDK shim
- `LICENSE` — MIT
