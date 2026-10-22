Keep the sidebar organized without dragging threads around: each new thread
lands in the section it belongs to, under a name you can tell apart at a
glance.

## What you get

- New top-level threads move into the best-matching sidebar section on their
  first turn.
- Threads that fit nowhere go to `other`, which is created when missing.
- Routing hints in settings describe sections whose names are ambiguous.
- Untitled threads get a funky name: a one-word topic and a name, often
  alliterative, like `hss-warrior`, `review-beast`, or `rfc-randy`. No two
  recent threads share a name, and `plugin` and `plugins` threads share one
  topic. Turn it off with the `naming` setting.
- A section or title you pick yourself, or a move or rename you make while
  routing runs, always wins. Each thread is routed once.

## How it works

On a thread's first turn, the plugin starts a short-lived hidden thread that
sees your section names, a few recent titles from each, the project, and the
new thread's title and first message, then names one section and a one-word
topic for the thread's name. It runs on your own agent provider, by default
`claude-code` with `claude-haiku-4-5-20251001`, so each routed thread costs one
small classifier turn on that provider. A thread titled like recent threads
that share a section, such as a daily automation run, joins them without one.
Change the provider and model with `bb plugin config thread-router`.
