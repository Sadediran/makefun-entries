// Capitulation-bounce + regime-gated momentum bot for cbBTC/USDC, 1-minute bars.
//
// Strategy (long only, one position, full size, bigint integer math throughout
// so two runs on the same bars produce byte-identical orders):
//
// The dev window falls ~5% in its first 7 hours and then ranges for 17 hours.
// Every shipped baseline loses on it (buy-and-hold -52.59, ema-cross -109.38,
// rsi-bollinger -65.83): chasing 1-minute moves pays ~26 bps a round trip and
// the hourly structure mean-reverts, so this bot trades rarely and only on
// two high-conviction setups, then rides the move with a wide trailing stop:
//
// 1. Capitulation bounce. After a deep multi-hour decline (240-minute return
//    <= -2.5%) AND a strong short bounce (15-minute return >= +0.5%), buy.
//    This catches the window's bottom: the market's -4.9% washout ends in one
//    sharp low, and the bounce confirms the turn instead of catching the
//    falling knife (buying the lower Bollinger band or every dip lost -65 to
//    -127 in screening).
// 2. Regime-gated momentum. When the 60-minute return is >= +0.5% AND the
//    240-minute return is >= 0 (a real uptrend, not a bounce inside a
//    downtrend), buy. Ungated momentum entries lost ~22 on the dev window;
//    the regime gate keeps the bot out while the 4-hour trend is down.
//
// Exits (same for both entries): take profit +2.0% over cost, stop loss -0.8%
// under cost, or a 1.5% trailing stop below the position's peak value at a
// bar close. The wide trail matters: the winning dev trade rides +2.2% from
// the bottom, and tight exits (0.6-0.8%) chop it off at ~breakeven.
//
// Risk controls: no new entries in the last 60 bars (a fresh position held
// to the end would pay the flattening cost for nothing), at most one open
// position, buys spend all cash, sells empty the whole position, and every
// order caps slippage at 100 bps from the close it was decided on.
//
// Screened locally (exact-harness replica, validated to the cent against the
// kit's ema-cross baseline): dev-window net PnL +7.87 USDC over 2 round
// trips, max drawdown 1.22%. The bounce-only variant scores +18.22 but never
// trades in a rising market, so the gated-momentum leg is kept: it costs ~10
// on the dev window and is what lets the bot trade at all when the race
// window trends up.

import { runBars, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 100;
/** No new entries in the last 60 bars of the window. */
const LAST_ENTRY_SEQ = 1380;
/** Entry thresholds, in per-mille of the reference close (integer ratios). */
const DECLINE_240_BPS = 25n; // 240-minute return <= -2.5% for the bounce setup
const BOUNCE_15_BPS = 5n; // 15-minute return >= +0.5% confirms the turn
const IGNITION_60_BPS = 5n; // 60-minute return >= +0.5% for the momentum setup
/** Exit thresholds, in per-mille of cost / peak value. */
const TAKE_PROFIT_BPS = 20n; // +2.0% over cost
const STOP_LOSS_BPS = 8n; // -0.8% under cost
const TRAIL_BPS = 15n; // -1.5% below the peak position value

const closes: bigint[] = [];
let peakValue = 0n;
/** Seq of the batch on which the last sell was decided; re-entries wait out
 *  a short cooldown so an exit is not chased straight back into the same
 *  move (the exit just said the move was over or the stop was hit). */
let lastSellSeq = -1000;
const REENTRY_COOLDOWN_BARS = 30;

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
    // Setup 1: capitulation bounce — deep 4-hour decline, then a sharp bounce.
    const bounce =
      close * 1000n <= close240 * (1000n - DECLINE_240_BPS) &&
      close * 1000n >= close15 * (1000n + BOUNCE_15_BPS);
    // Setup 2: momentum, only while the 4-hour trend is not down.
    const ignition =
      close * 1000n >= close60 * (1000n + IGNITION_60_BPS) && close >= close240;
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
