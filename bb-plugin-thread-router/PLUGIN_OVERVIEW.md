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

On a thread's first turn, the plugin runs the local `claude` CLI once, with no
tools, MCP servers, or saved session. It sees your section names, a few recent
titles from each, the project, and the new thread's title and first message,
then names one section and a one-word topic for the thread's name. No agent
thread is started, so nothing extra shows up in your threads or prompt
history. The default model is `claude-haiku-4-5-20251001`. A thread titled like
recent threads that share a section, such as a daily automation run, joins them
without a call. Change the model or the `claude` path with
`bb plugin config thread-router`.
