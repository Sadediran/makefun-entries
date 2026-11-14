"""Capitulation-bounce + regime-gated momentum bot for cbBTC/USDC, 1-minute bars.

Strategy (long only, one position, full size, integer math throughout so two
runs on the same bars produce byte-identical orders):

The dev window falls ~5% in its first 7 hours and then ranges for 17 hours.
Every shipped baseline loses on it (buy-and-hold -52.59, ema-cross -109.38,
rsi-bollinger -65.83): chasing 1-minute moves pays ~26 bps a round trip and
the hourly structure mean-reverts, so this bot trades rarely and only on
two high-conviction setups, then rides the move with a wide trailing stop:

1. Capitulation bounce. After a deep multi-hour decline (240-minute
   return <= -2.5%) AND a strong short bounce (15-minute return >= +0.5%),
   buy. This catches the window's bottom: the market's -4.9% washout ends
   in one sharp low, and the bounce confirms the turn instead of catching
   the falling knife (buying the lower Bollinger band or every dip lost
   -65 to -127 in screening).
2. Regime-gated momentum. When the 60-minute return is >= +0.5% AND the
   240-minute return is >= 0 (a real uptrend, not a bounce inside a
   downtrend), buy. Ungated momentum entries lost ~22 on the dev window;
   the regime gate keeps the bot out while the 4-hour trend is down.

Exits (same for both entries): take profit +2.0% over cost, stop loss -0.8%
under cost, or a 1.5% trailing stop below the position's peak value at a
bar close. The wide trail matters: the winning dev trade rides +2.2% from
the bottom, and tight exits (0.6-0.8%) chop it off at ~breakeven.

Risk controls: no new entries in the last 60 bars (a fresh position held
to the end would pay the flattening cost for nothing), at most one open
position, buys spend all cash, sells empty the whole position, and every
order caps slippage at 100 bps from the close it was decided on.

Screened locally (exact-harness replica, validated to the cent against the
kit's ema-cross baseline): dev-window net PnL +7.87 USDC over 2 round
trips, max drawdown 1.22%. The bounce-only variant scores +18.22 but
never trades in a rising market, so the gated-momentum leg is kept: it
costs ~10 on the dev window and is what lets the bot trade at all when
the race window trends up.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "vendor"))
import makefun_bars

SYMBOL = "CBBTC"
MAX_SLIPPAGE_BPS = 100
# No new entries in the last 60 bars of the window.
LAST_ENTRY_SEQ = 1380
# Entry thresholds, in per-mille of the reference close (integer ratios).
DECLINE_240_BPS = 25      # 240-minute return <= -2.5% for the bounce setup
BOUNCE_15_BPS = 5         # 15-minute return >= +0.5% confirms the turn
IGNITION_60_BPS = 5       # 60-minute return >= +0.5% for the momentum setup
# Exit thresholds, in per-mille of cost / peak value.
TAKE_PROFIT_BPS = 20      # +2.0% over cost
STOP_LOSS_BPS = 8         # -0.8% under cost
TRAIL_BPS = 15            # -1.5% below the peak position value

closes = []
peak_value = 0


def on_batch(state, batch):
    global peak_value
    if state.warming_up:
        return []
    # Decide only on a batch that actually carries this symbol's bar.
    if not any(b["symbol"] == SYMBOL for b in batch["bars"]):
        return []
    bar = state.latest[SYMBOL]
    close = int(bar["c"])
    closes.append(close)

    held = state.positions.get(SYMBOL)
    if held is not None:
        value = state.value(SYMBOL, held.qty)
        if value > peak_value:
            peak_value = value
        take_profit = value * 1000 >= held.cost * (1000 + TAKE_PROFIT_BPS)
        stop_loss = value * 1000 <= held.cost * (1000 - STOP_LOSS_BPS)
        trailing = value * 1000 <= peak_value * (1000 - TRAIL_BPS)
        if take_profit or stop_loss or trailing:
            peak_value = 0
            return [{"side": "sell", "symbol": SYMBOL, "qty": held.qty,
                     "max_slippage_bps": MAX_SLIPPAGE_BPS}]
        return []

    if state.seq > LAST_ENTRY_SEQ:
        return []
    n = len(closes)
    if n < 241:
        return []
    close_240 = closes[n - 241]
    close_60 = closes[n - 61]
    close_15 = closes[n - 16]
    # Setup 1: capitulation bounce — deep 4-hour decline, then a sharp bounce.
    bounce = (close * 1000 <= close_240 * (1000 - DECLINE_240_BPS)
              and close * 1000 >= close_15 * (1000 + BOUNCE_15_BPS))
    # Setup 2: momentum, only while the 4-hour trend is not down.
    ignition = (close * 1000 >= close_60 * (1000 + IGNITION_60_BPS)
                and close >= close_240)
    if bounce or ignition:
        if state.cash >= 1_000_000:
            peak_value = 0
            return [{"side": "buy", "symbol": SYMBOL,
                     "notional_quote_units": state.cash,
                     "max_slippage_bps": MAX_SLIPPAGE_BPS}]
    return []


makefun_bars.run(on_batch)
