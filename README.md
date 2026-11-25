# Tiny SOL Dip Bot — Beat Buy-and-Hold on Solana

[![make.fun](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/calebakinjomo/tiny-bot-beat-buy-and-hold-solana/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/calebakinjomo/tiny-bot-beat-buy-and-hold-solana/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

A tiny long-only paper-trading bot for the [make.fun](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) bounty **"Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana"**. It reads hourly Solana bars (SOL, JITOSOL, WETH, WIF, RAY, POPCAT, FARTCOIN) and decides when to hold and when to sit in USDC.

## Strategy

Buy-the-dip with quick profits and tight stops:

- **Dip:** the close sits at least 1.5% under its trailing 14-bar mean, and its trailing 24-bar return is no worse than −12% — skip a dip inside a free-fall, where the dip keeps dipping.
- **Entry:** when the dip holds, on a symbol not held; filled at the next open.
- **Exit:** the whole position on +3% take-profit or −5% stop-loss, whichever comes first.
- **Sizing:** equity split evenly over up to 7 slots, each buy capped at 25% of equity (the harness max-weight cap).

One decision per bar, deterministic float64 math on closes only — no clock, no environment read, no randomness — so the harness's two executions produce byte-identical action logs.

## Dev-window result

Graded with the kit's `grade-local` (process driver) on the frozen dev window (136 hourly bars, $10,000 capital):

| | Net PnL (USDC) |
|---|---|
| **This bot** | **+486.93** (+4.87%, 27 trades, win rate 0.76, max drawdown 2.75%) |
| Buy-and-hold | −869.34 |
| Best house baseline (MACD+CCI) | −20.22 |

The dev figure is not a forecast for the final window (3 unseen UTC days, 27–30 Nov 2026): the edge is the rule, not the number. At 2× fees the dev PnL is +436.45 USDC.

## Layout

- `main.ts` — the bot (entrypoint; runs on Node 22 as `node main.ts`)
- `vendor/makefun-bars.ts` — byte-identical copy of the kit's `sdk/makefun-bars.ts` (the `agent-fun/bars-replay/v1` shim)
- `LICENSE` — MIT

## Run it

```sh
node main.ts   # speaks agent-fun/bars-replay/v1 on stdin/stdout
```

Grade locally with the kit:

```sh
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
```

## License

MIT — see [LICENSE](LICENSE).
