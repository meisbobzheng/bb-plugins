# bb-plugin-chime

Plays a sound when a bb thread needs your approval or an answer, so you can
look away while agents work. It can also chime when a thread finishes or fails.

## Use it

- Install the plugin; the next thread that asks for approval or a question
  plays Glass at 60%.
- A burst of requests within 2 seconds plays one sound, and hidden helper
  threads never chime.
- Pick a sound per event, or None, in the plugin's settings.
- `bb chime test [input|finished|failed]` plays an event's sound (`input` by
  default) so you can hear it before you pick it. `bb chime status` prints the
  current sounds and volume.

## Settings

| Setting | Default | What it does |
| --- | --- | --- |
| Needs input sound | Glass | Plays when a thread asks for your approval or an answer |
| Thread finished sound | None | Plays when an active thread finishes its turn |
| Thread failed sound | None | Plays when a thread stops with an error |
| Volume (%) | 60 | 0 is silent |

The sounds are the macOS system sounds: Basso, Blow, Bottle, Frog, Funk, Glass,
Hero, Morse, Ping, Pop, Purr, Sosumi, Submarine, and Tink.

## How it works

The server listens for bb's `interaction.pending`, `thread.idle`, and
`thread.failed` events and plays the sound on the machine running bb: with
`afplay` on macOS, or on Linux with `paplay` (then `aplay`) and the freedesktop
sound theme's message, complete, and error sounds, whichever sound you picked.
A finished sound plays only for a thread this server saw become active, so
threads that settle without a turn stay quiet. If no player works, the plugin
logs once and stays silent.

## Develop

```
npm install
npm run check          # typecheck, tests, build
bb plugin install .    # register this checkout in bb
bb plugin dev          # rebuild and reload on save
```

Tests inject the player and the clock; nothing plays a sound.
