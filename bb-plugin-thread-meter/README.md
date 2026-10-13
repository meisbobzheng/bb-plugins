# bb-plugin-thread-meter

Shows context, token cost, and plan usage in the composer's control row, on the
same line as the model picker.

```
[+] Opus 5.5 Extra High ⌄                ◔ 26%  $4.12  13% plan  🎙  ■
```

Click the meter for the breakdown:

- **Context**: tokens used out of the model's window, and the auto-compact
  threshold when the provider reports one.
- **Tokens**: input, cache read, cache write, and output, summed over every
  turn in the thread, plus an API-equivalent cost.
- **Plan usage**: every subscription window (session, weekly, per-model) with
  its reset time. The trigger shows whichever window is closest to its limit.

The context ring and plan figure turn amber at 75% and red at 90%, the same
thresholds bb uses for its own context indicator.

## Where the numbers come from

| Figure | Source | Refreshes on |
| --- | --- | --- |
| Context | `threads.context` | `thread/contextWindowUsage/updated`, compaction, context clear |
| Tokens and cost | `thread/tokenUsage/updated` events, each priced with the model from the preceding `client/turn/requested` | each new token-usage event |
| Plan usage | the `provider-usage.v1` RPC published by the thread's provider plugin | each `turn/completed` |

Updates arrive over bb's realtime `thread:changed` feed, with no polling. All
feeds reload after a realtime reconnect.

## Caveats

- Cost is an estimate at Anthropic API list prices, not what a subscription
  bills. Turns on models missing from the price table in `spend.ts` are
  counted but not priced. Update that table when prices change.
- Claude Code reports token usage when a turn finishes. The cost appears after
  the first turn completes and does not move during a running turn.
- bb hides composer actions in the compact (mobile) layout, so the meter does
  not show there.

## Development

```
npm install --include=dev
npm test             # vitest: pricing and aggregation, composer wiring
npm run typecheck
bb plugin build .
bb plugin install .  # or `bb plugin dev` for rebuild-on-save
```
