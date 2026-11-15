// Armed deep-dip bounce + regime-gated momentum bot for cbBTC/USDC, 1-minute bars.
//
// Strategy (long only, one position, full size, bigint integer math throughout
// so two runs on the same bars produce byte-identical orders). Screened on the
// dev windows of this race and of the previous race (btc-race-24h-20261113-2314)
// with an exact replica of the harness fill model, then verified with the kit's
// grade-local. The two windows teach the same lesson, and the two previous
// races agree on what wins: a deep dip, a confirmed V-reversal bounce, a
// handful of trades. The whole top 10 of the previous race were deep-dip
// buyers with 2 trades each; this race's dev leaders are the same family
// (#1 +$46.50, 2 trades). So this bot trades rarely, on one high-conviction
// setup, and rides the move:
//
// 1. Armed deep-dip bounce. The bot ARMS only when the 240-minute return
//    falls to -4.0% or worse (a real capitulation, not a drift), stays armed
//    for 30 bars after the last such bar, and buys only while armed AND the
//    15-minute return is +0.5% or better (the bounce confirms the turn).
//    The arming is what keeps it out of the mid-decline dead-cat bounces:
//    on both dev windows the fake bounces sit at 240m -2.8% to -3.9% and
//    never arm, while the real bottoms arm (240m -4.25% and -3.96%) and then
//    confirm. A plain "240m <= -3% and 15m >= +0.3%" rule buys the fakes
//    and loses ~$11 a time; the armed rule takes no losing trade on either
//    window. The bounce threshold is +0.5%, not +0.3%: at +0.3% the entry
//    depends on a single bar's 15m print (+0.35% at the new window's
//    trough), while +0.5% fires on the same V one bar later at a nearly
//    identical fill and never fires on the fakes.
// 2. Regime-gated momentum (uptrend insurance). If the race window trends up
//    with no -4% dip, the bounce leg never trades and the bot would score
//    nothing, so a second leg buys when the 60-minute return is +1.5% or
//    better AND the 240-minute return is +1.5% or better AND the 15-minute
//    return is +0.3% or better (a real, established uptrend, not a bounce
//    inside a downtrend or the top of a V just sold). It is blocked for 240
//    bars after any sell so it never chases the top of a bounce the bot
//    just exited. It fired on neither dev window (cost $0 there) and exists
//    only so an uptrending race window still gets a trade.
//
// Exits (same for both entries): take profit +3.5% over cost, stop loss
// -0.8% under cost, a 1.2% trailing stop below the position's peak value
// at a bar close. The take profit is set where the dev Vs actually end: the new window's V runs +4.9% from the armed entry and the
// old window's +2.2%, so +3.5% banks most of a strong V and still fires
// when the V is only a little stronger than +3.5%; the trailing stop is
// what exits a weaker V, near its peak minus 1.2%. A +2% take profit caps
// the strong V at ~+$18; a +4.5% one never fires on the weak V and leaves
// ~+$4. +3.5% is the plateau both windows agree on (identical grade for
// +3.5% and +4.0% on the new window).
//
// Risk controls: no new entries in the last 60 bars; a 30-bar cooldown
// after any sell; at most one open position; buys spend all cash; sells
// empty the position; every order caps slippage at 300 bps from the close
// it was decided on (fills are at the next bar's open, which can gap more
// than 100 bps on a sharp V; the cap only guards against pathological
// opens, it never worsens a fill).

import { runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 300;
/** No new entries in the last 60 bars of the window. */
const LAST_ENTRY_SEQ = 1380;
/** Arm when the 240-minute return is -4.0% or worse; stay armed this long. */
const ARM_DECLINE_BPS = 40n;
const ARM_GRACE_BARS = 30;
/** Bounce confirmation: 15-minute return >= +0.5% while armed. */
const BOUNCE_15_BPS = 5n;
/** Momentum leg: 60m >= +1.5% and 240m >= +1.5% and 15m >= +0.3%. */
const IGNITION_60_BPS = 15n;
const IGNITION_240_BPS = 15n;
const IGNITION_15_BPS = 3n;
/** No momentum entry within this many bars after any sell. */
const MOMENTUM_BLOCK_BARS = 240;
/** Exit thresholds, in per-mille of cost / peak value. */
const TAKE_PROFIT_BPS = 35n; // +3.5% over cost
const STOP_LOSS_BPS = 8n; // -0.8% under cost
const TRAIL_BPS = 12n; // -1.2% below the peak position value

const closes: bigint[] = [];
let peakValue = 0n;
/** Seq of the batch on which the last sell was decided; re-entries wait out
 *  a short cooldown so an exit is not chased straight back into the same
 *  move (the exit just said the move was over or the stop was hit). */
let lastSellSeq = -1000;
const REENTRY_COOLDOWN_BARS = 30;
/** Last seq at which the arm condition held; the bot stays armed for
 *  ARM_GRACE_BARS after it. */
let armedUntilSeq = -1000;

await runBars({
  onBatch(state, batch) {
    if (state.warmingUp) return [];
    // Decide only on a batch that actually carries this symbol's bar.
    if (!batch.bars.some((b) => b.symbol === SYMBOL)) return [];
    const close = state.close(SYMBOL);
    if (close === null) return [];
    closes.push(close);

    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      if (value > peakValue) peakValue = value;
      const takeProfit = value * 1000n >= held.cost * (1000n + TAKE_PROFIT_BPS);
      const stopLoss = value * 1000n <= held.cost * (1000n - STOP_LOSS_BPS);
      const trailing = value * 1000n <= peakValue * (1000n - TRAIL_BPS);
      if (takeProfit || stopLoss || trailing) {
        peakValue = 0n;
        lastSellSeq = state.seq;
        const sells: SellInput[] = [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        return sells;
      }
      return [];
    }

    if (state.seq > LAST_ENTRY_SEQ) return [];
    if (state.seq - lastSellSeq < REENTRY_COOLDOWN_BARS) return [];
    const n = closes.length;
    if (n < 241) return [];
    const close240 = closes[n - 241];
    const close60 = closes[n - 61];
    const close15 = closes[n - 16];
    // Arm on a real capitulation: the 240-minute return at -4.0% or worse.
    // The arm lapses ARM_GRACE_BARS after the last bar that deep, so a
    // bounce that confirms a little later still counts.
    if (close * 1000n <= close240 * (1000n - ARM_DECLINE_BPS)) {
      armedUntilSeq = state.seq + ARM_GRACE_BARS;
    }
    // Setup 1: armed deep-dip bounce — deep decline, then a sharp bounce.
    const bounce =
      state.seq <= armedUntilSeq &&
      close * 1000n >= close15 * (1000n + BOUNCE_15_BPS);
    // Setup 2: momentum, only in an established uptrend, and never soon
    // after a sell (never chase the top of a bounce just exited).
    const ignition =
      state.seq - lastSellSeq >= MOMENTUM_BLOCK_BARS &&
      close * 1000n >= close60 * (1000n + IGNITION_60_BPS) &&
      close * 1000n >= close240 * (1000n + IGNITION_240_BPS) &&
      close * 1000n >= close15 * (1000n + IGNITION_15_BPS);
    if (bounce || ignition) {
      if (state.cash >= 1_000_000n) {
        peakValue = 0n;
        const buys: BuyInput[] = [{ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS }];
        return buys;
      }
    }
    return [];
  },
});
