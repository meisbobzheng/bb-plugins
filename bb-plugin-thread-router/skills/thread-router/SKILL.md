---
name: thread-router
description: How the Thread Router plugin files new BB threads into sidebar sections, and how to tune it.
---

# Thread Router

When a new top-level thread starts its first turn, Thread Router picks the
best-matching sidebar section and moves the thread there. It falls back to the
`other` section (created if missing) when no section clearly fits.

## How it decides

- A hidden, short-lived classifier thread (default `claude-code` /
  `claude-haiku-4-5-20251001`) runs in the new thread's environment. It sees
  every section name, up to 8 recent thread titles per section, the project
  name, the thread title, and the first message.
- Only threads that are new, unsectioned, top-level, visible, and not created by
  this plugin are routed. A section picked at creation time, or a manual move
  during classification, always wins.
- Each thread is routed once. Moving it afterward is never undone.

## Settings

Edit with `bb plugin config thread-router` or Settings → Plugins:

- `providerId` — provider for the classifier thread.
- `model` — classifier model.
- `hints` — free-text notes on what belongs in each section. Use it when
  section names are opaque.

Failures are logged to `<dataDir>/plugins/thread-router/logs/plugin.log`; a
failed classification leaves the thread in `other`.
