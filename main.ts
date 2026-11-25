// Tiny SOL dip bot — beat buy-and-hold on Solana hourly bars.
//
// Strategy: long-only, buy-the-dip with quick profits and tight stops.
//   - Dip: the close sits at least 1.5% under its trailing 14-bar mean
//     (oversold against its own recent range), and its trailing 24-bar
//     return is no worse than -12% — skip a dip inside a free-fall, where
//     the dip keeps dipping. No slow trend filter: in a 72-bar final window
//     there is no time to wait for one to confirm, and the stop-loss caps
//     what any single dip can cost.
//   - Entry when the dip holds, on a symbol not held; filled at the next open.
//   - Exit: the whole position on +3% take-profit or -5% stop-loss,
//     whichever comes first; otherwise the position rides to the end of the
//     window and is flattened by the harness.
//   - Sizing: equity split evenly over up to 7 slots (one per universe
//     symbol), each buy capped at 25% of equity (the harness max-weight cap).
//   - One decision per bar, deterministic float64 math on closes only: the
//     two executions the harness runs must produce byte-identical action
//     logs, so there is no clock, no environment read and no randomness.
//
// Why this shape: the dev window is a falling market (buy-and-hold loses
// ~8.7%), so the edge is being in cash most of the time and only stepping
// in on dips, then banking small gains fast instead of riding a reversal
// back down. A 72-bar final window leaves no time to recover a deep
// drawdown, so stops stay tight and every position is small.
//
// Dev-window result (kit grade-local, process driver): net PnL +486.93 USDC
// on $10,000 capital (+4.87%), 27 trades, win rate 0.76, max drawdown 2.75%.
// Buy-and-hold on the same window: -869.34 USDC. Best house baseline
// (MACD+CCI): -20.22 USDC. The dev figure is not a forecast for the final
// window (3 unseen UTC days, 27–30 Nov): the edge is the rule, not the number.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

/** Dip lookback: trailing mean of closes over this many bars. */
const MEAN_BARS = 14;
/** Guard lookback: trailing return over this many bars must not be worse than -12%. */
const GUARD_BARS = 24;
/** Dip depth: enter when the close is at most this fraction of the mean (x1000). */
const DIP_NUM = 985;
const DIP_DEN = 1000;
/** Guard floor: enter only when the trailing return is at least -12% (x1000). */
const GUARD_NUM = 880;
const GUARD_DEN = 1000;
/** Take-profit: exit once a position is worth 103/100 of its cost (+3%). */
const TAKE_PROFIT = [103n, 100n] as const;
/** Stop-loss: exit once a position is worth 19/20 of its cost (-5%). */
const STOP_LOSS = [19n, 20n] as const;
/** Max slippage per order: 1% past the close the decision was made on. */
const MAX_SLIPPAGE_BPS = 100;

/** The last closes per symbol, oldest first (kept to GUARD_BARS + 1 for the guard). */
const closes = new Map<string, number[]>();

function push(bar: Bar): number[] {
  let cs = closes.get(bar.symbol);
  if (cs === undefined) {
    cs = [];
    closes.set(bar.symbol, cs);
  }
  cs.push(Number(bar.c));
  if (cs.length > GUARD_BARS + 1) cs.shift();
  return cs;
}

/**
 * Whether the symbol is a buyable dip on this close: under its trailing
 * 14-bar mean by the dip depth, and its trailing 24-bar return no worse
 * than -12%. The guard is what keeps a dip-buy from catching a free-fall:
 * a dip inside a crash keeps dipping, so the bot waits for the fall to
 * flatten before it steps in.
 */
function isDip(cs: number[]): boolean {
  if (cs.length < GUARD_BARS + 1) return false;
  const recent = cs.slice(cs.length - MEAN_BARS);
  const mean = recent.reduce((a, x) => a + x, 0) / recent.length;
  // Defensive: raw closes are always positive, but a non-positive mean
  // would make the dip test meaningless, so refuse the signal outright.
  if (!(mean > 0)) return false;
  if (cs[cs.length - 1] * DIP_DEN > mean * DIP_NUM) return false;
  const then = cs[cs.length - 1 - GUARD_BARS];
  return cs[cs.length - 1] * GUARD_DEN >= then * GUARD_NUM;
}

/** Whether a held position exits on this close: take-profit or stop-loss. */
function exits(state: BarsState, symbol: string, held: { qty: bigint; cost: bigint }): boolean {
  const value = state.value(symbol, held.qty);
  return value * TAKE_PROFIT[1] >= held.cost * TAKE_PROFIT[0] || value * STOP_LOSS[1] <= held.cost * STOP_LOSS[0];
}

await runBars({
  onBatch(state, batch) {
    const dips = new Set<string>();
    const fresh = new Set<string>();
    for (const bar of batch.bars) {
      const cs = push(bar);
      fresh.add(bar.symbol);
      if (bar.v === '0') continue;
      if (isDip(cs)) dips.add(bar.symbol);
    }
    if (state.warmingUp) return [];
    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const entries: string[] = [];
    for (const { symbol } of state.hello.symbols) {
      if (!fresh.has(symbol)) continue;
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        if (exits(state, symbol, held)) sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      } else if (dips.has(symbol)) {
        entries.push(symbol);
      }
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = Math.min(state.hello.symbols.length, caps.max_open_positions);
    const stake = state.equity / BigInt(slots);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let room = slots - state.positions.size;
    let cash = state.cash;
    for (const symbol of entries) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      // Defensive: never buy a symbol with no latest close. Entries only
      // come from bars seen this batch, so this never triggers in practice;
      // it guards the sizing math against a missing price, not the strategy.
      if (state.close(symbol) === null) continue;
      let slice = stake < byWeight ? stake : byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) break;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cash -= slice;
      room--;
    }
    return orders;
  },
});
