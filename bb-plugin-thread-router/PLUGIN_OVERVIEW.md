Keep the sidebar organized without dragging threads around: each new thread
lands in the section it belongs to.

## What you get

- New top-level threads move into the best-matching sidebar section on their
  first turn.
- Threads that fit nowhere go to `other`, which is created when missing.
- Routing hints in settings describe sections whose names are ambiguous.
- A section you pick yourself, or a move you make while routing runs, always
  wins. Each thread is routed once.

## How it works

On a thread's first turn, the plugin starts a short-lived hidden thread that
sees your section names, a few recent titles from each, the project, and the
new thread's title and first message, then names one section. It runs on your
own agent provider, by default `claude-code` with
`claude-haiku-4-5-20251001`, so each routed thread costs one small classifier
turn on that provider. Change the provider and model with
`bb plugin config thread-router`.
