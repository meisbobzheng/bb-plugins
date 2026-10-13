See how much context a thread has used, what it would cost at API prices, and
how close you are to your plan's limits, right beside the model picker.

## What you get

- A compact meter in every thread and new-thread composer: context used, cost
  so far, and your busiest plan window.
- A breakdown on click: context against the model's window, input and cache
  and output tokens, and every plan window with its reset time.
- Live updates as the agent works, with no polling.

## How it works

The meter reads data bb already records: context-window snapshots and per-turn
token usage from the thread's events, and plan usage from the provider plugin.
Each turn is priced at Anthropic list rates for the model that ran it. Nothing
leaves the machine, and the plugin needs no account or API key.
